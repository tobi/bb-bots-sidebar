import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse } from "node:path";
import { z } from "zod";
import { stateFileSchema, type BotMetadata, type BotStateFile } from "../contract";
import { validateMemory } from "./memory-limit";
import { nextTimestamp, type BotStore, type LegacyBotStateSource } from "./bot-store";

export class BotStateConflictError extends Error {
  override name = "BotStateConflictError";
}

export const stateFiles = stateFileSchema.options;
export const legacyStateFiles = ["SOUL.md", "AGENTS.md", "MEMORY.md", "settings.json"] as const;
type StoredStateFile = typeof legacyStateFiles[number];
const settingsSchema = z.record(z.string(), z.json());
const hash = (content: string) => createHash("sha256").update(content, "utf8").digest("hex");
export function stateContent(bot: BotMetadata, file: StoredStateFile): string {
  if (!legacyStateFiles.includes(file)) throw new Error("Unknown state file");
  return file === "SOUL.md" ? bot.soul : file === "AGENTS.md" ? bot.agents : file === "MEMORY.md" ? bot.memory : `${JSON.stringify(bot.settings, null, 2)}\n`;
}
export function applyState(bot: BotMetadata, file: StoredStateFile, content: string, legacyImport = false): BotMetadata {
  if (!legacyStateFiles.includes(file)) throw new Error("Unknown state file");
  if (file === "MEMORY.md" && !legacyImport) validateMemory(content);
  if (content.length > (file === "SOUL.md" || file === "AGENTS.md" ? 4096 : 16384)) throw new Error(`${file} is too large`);
  if (file === "SOUL.md") return { ...bot, soul: content };
  if (file === "AGENTS.md") return { ...bot, agents: content };
  if (file === "MEMORY.md") return { ...bot, memory: content };
  const next = { ...bot, settings: settingsSchema.parse(JSON.parse(content)) };
  if (stateContent(next, file).length > 16384) throw new Error(`${file} is too large`);
  return next;
}

function assertId(id: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new Error("Invalid bot ID");
}
function withHashes(bot: BotMetadata): BotMetadata {
  return { ...bot, stateHashes: { ...bot.stateHashes, ...Object.fromEntries(stateFiles.map((file) => [file, hash(stateContent(bot, file))])) } as BotMetadata["stateHashes"] };
}
function document(bot: BotMetadata, file: BotStateFile) {
  const content = stateContent(bot, file);
  return { botId: bot.id, file, content, sha256: hash(content) };
}
function missing(error: unknown) { return (error as NodeJS.ErrnoException)?.code === "ENOENT"; }
function stat(path: string) {
  try { return lstatSync(path); } catch (error) { if (missing(error)) return null; throw error; }
}
function assertDirectory(path: string) {
  // Check ancestors as well: a safe-looking leaf below a symlink is not confined.
  if (path !== parse(path).root) assertDirectory(dirname(path));
  if (!lstatSync(path).isDirectory()) throw new Error("Private state root must be a real directory, not a symlink");
}
function ensureDirectory(path: string) {
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  assertDirectory(path);
}
function privateMode(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { if ((fstatSync(fd).mode & 0o777) !== 0o700) fchmodSync(fd, 0o700); } finally { closeSync(fd); }
}
function assertExport(path: string) {
  const info = stat(path);
  if (info && (!info.isFile() || info.nlink !== 1)) throw new Error("Private state export must be an unlinked regular file, not a symlink");
  return info;
}
function atomicExport(directory: string, file: string, content: string) {
  const destination = join(directory, file);
  const existing = assertExport(destination);
  if (existing && existing.size === Buffer.byteLength(content) && (existing.mode & 0o777) === 0o600) {
    const current = openSync(destination, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = fstatSync(current);
      if (!info.isFile() || info.nlink !== 1) throw new Error("Unsafe state export");
      if (readFileSync(current, "utf8") === content) return;
    } finally { closeSync(current); }
  }
  const temporary = join(directory, `.export-${randomUUID()}.tmp`);
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try { fchmodSync(fd, 0o600); writeFileSync(fd, content, "utf8"); } finally { closeSync(fd); }
    renameSync(temporary, join(directory, file));
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (!missing(error)) throw error; }
  }
}

type StateWarnings = Partial<Record<"source" | "export", string>>;
export function createPrivateBotState(bb: BbPluginApi, store: BotStore, publish: () => void) {
  const preparing = new Map<string, Promise<BotMetadata>>();
  const localWarnings = new Map<string, StateWarnings>();
  function directory(botId: string) {
    assertId(botId);
    if (!isAbsolute(store.databasePath)) throw new Error("Private state requires an absolute SDK storage database path");
    return join(dirname(store.databasePath), "state", botId);
  }
  function warning(botId: string, kind: keyof StateWarnings, message?: string) {
    // Warning persistence/logging is itself best-effort, never a failed state write.
    const key = `private-state-warning:${botId}`;
    let previous = localWarnings.get(botId);
    try { previous ??= store.state<StateWarnings>(key) ?? {}; } catch { /* Retain the in-memory warning if storage is unavailable. */ }
    const next = { ...previous };
    if (message) next[kind] = message; else delete next[kind];
    localWarnings.set(botId, next);
    try { store.setState(key, next); } catch { /* The canonical write has already committed. */ }
    if (message && previous?.[kind] !== message) {
      try { bb.log.warn(message); } catch { /* Logging cannot invalidate a committed write. */ }
    }
  }
  function warnings(): string[] {
    return store.list().flatMap((bot) => Object.values(localWarnings.get(bot.id) ?? store.state<StateWarnings>(`private-state-warning:${bot.id}`) ?? {}));
  }
  async function mirror(input: BotMetadata) {
    try {
      // A caller's stale snapshot must never replace newer committed exports.
      const bot = store.require(input.id);
      const path = directory(bot.id);
      const root = dirname(path);
      assertDirectory(dirname(root));
      ensureDirectory(root);
      ensureDirectory(path);
      const markerPath = join(path, "bot.json");
      const markerInfo = assertExport(markerPath);
      if (markerInfo) {
        const fd = openSync(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          if (fstatSync(fd).size > 1024 * 1024) throw new Error("Private state ownership marker is too large");
          const marker: unknown = JSON.parse(readFileSync(fd, "utf8"));
          if (!marker || typeof marker !== "object" || !("version" in marker) || marker.version !== 3 || !("id" in marker) || marker.id !== bot.id) throw new Error("Private state ownership marker does not match this bot");
        } finally { closeSync(fd); }
      } else if (readdirSync(path).length) {
        throw new Error("Private state directory has no ownership marker; refusing to adopt existing files");
      }
      // Preflight every destination before writing any exports. These bounded,
      // synchronous operations never yield between ownership checks and renames.
      for (const file of stateFiles) assertExport(join(path, file));
      privateMode(root);
      privateMode(path);
      const { soul: _soul, agents: _agents, memory: _memory, settings: _settings, stateHashes: _hashes, ...metadata } = bot;
      atomicExport(path, "bot.json", `${JSON.stringify({ version: 3, ...metadata }, null, 2)}\n`);
      for (const file of stateFiles) atomicExport(path, file, stateContent(bot, file));
      warning(bot.id, "export");
    } catch {
      // Do not leak filesystem paths through warnings shown in bot/agent UIs.
      warning(input.id, "export", `Bot ${input.id}: private state exports could not be refreshed (storage unavailable or ownership unsafe). State remains saved in SQLite.`);
    }
  }
  async function importSource(bot: BotMetadata, source: LegacyBotStateSource) {
    const root = source.path.replace(/\/+$/, "");
    if ((!root.startsWith("/") && !root.startsWith("~/")) || root.split("/").includes("..") || root.includes("\0") || !root) throw new Error("Invalid legacy source");
    const readSource = async (file: string) => {
      const result = await bb.sdk.files.read({ hostId: source.hostId, rootPath: root, path: `${root}/${file}` });
      return result.contentEncoding === "utf8" ? result.content : Buffer.from(result.content, "base64").toString("utf8");
    };
    const checkOwner = async () => {
      const marker: unknown = JSON.parse(await readSource("bot.json"));
      if (!marker || typeof marker !== "object" || !("version" in marker) || marker.version !== 2 || !("id" in marker) || marker.id !== bot.id) throw new Error("Legacy ownership mismatch");
    };
    // Never fetch any state document before proving that the source is this bot's.
    await checkOwner();
    const contents: { file: StoredStateFile; content: string }[] = [];
    for (const file of legacyStateFiles) {
      const content = await readSource(file);
      applyState(bot, file, content, true);
      contents.push({ file, content });
    }
    await checkOwner(); // Discard the whole import if ownership changed mid-read.
    return contents;
  }
  async function initialize(botId: string) {
    const initial = store.require(botId);
    let imported: Awaited<ReturnType<typeof importSource>> | undefined;
    let sourceFailed = false;
    if (!initial.stateReady) {
      try {
        const source = store.legacySource(botId);
        if (!source) throw new Error("No legacy source");
        imported = await importSource(initial, source);
      } catch { sourceFailed = true; }
    }
    let changed = false;
    let usedFallback = false;
    const bot = store.mutate(botId, (current) => {
      let next = current;
      if (!current.stateReady) {
        if (imported) for (const state of imported) next = applyState(next, state.file, state.content, true);
        usedFallback = sourceFailed;
        next = { ...next, stateReady: true };
      }
      next = withHashes(next);
      changed = !current.stateReady || stateFiles.some((file) => current.stateHashes[file] !== next.stateHashes[file]);
      return changed ? { ...next, updatedAt: nextTimestamp(current.updatedAt) } : current;
    });
    if (usedFallback) warning(botId, "source", `Bot ${botId}: legacy state was missing, offline, corrupt, or not owned by this bot. Kept this bot's cached SQLite state; legacy import will not be retried.`);
    await mirror(bot);
    if (changed) publish();
    return store.require(botId);
  }
  function prepare(botId: string) {
    assertId(botId);
    const current = preparing.get(botId);
    if (current) return current;
    const promise = initialize(botId).finally(() => preparing.delete(botId));
    preparing.set(botId, promise);
    return promise;
  }
  async function read(bot: BotMetadata, file: BotStateFile) {
    assertId(bot.id);
    stateFileSchema.parse(file);
    if (!store.require(bot.id).stateReady) await prepare(bot.id);
    return document(store.require(bot.id), file);
  }
  async function update(botId: string, file: BotStateFile, content: string, expectedSha256: string) {
    assertId(botId);
    stateFileSchema.parse(file);
    const initial = store.require(botId);
    applyState(initial, file, content);
    if (!initial.stateReady) await prepare(botId);
    const bot = store.mutate(botId, (current) => {
      if (hash(stateContent(current, file)) !== expectedSha256) throw new BotStateConflictError(`${file} changed. Read it again and merge your update.`);
      return withHashes({ ...applyState(current, file, content), updatedAt: nextTimestamp(current.updatedAt) });
    });
    await mirror(bot);
    publish();
    return document(bot, file);
  }
  return { prepare, refresh: prepare, read, update, mirror, warnings, directory };
}
export type PrivateBotState = ReturnType<typeof createPrivateBotState>;
