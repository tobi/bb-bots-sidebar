import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotMetadata, BotStateFile } from "../contract";
import { createBotStore, EMPTY_HASHES } from "../lib/bot-store";
import { applyState, BotStateConflictError, createPrivateBotState, stateContent, stateFiles, legacyStateFiles } from "../lib/private-state";

const hash = (content: string) => createHash("sha256").update(content).digest("hex");
function bot(overrides: Partial<BotMetadata> = {}): BotMetadata {
  return {
    id: "bot_atlas", name: "Atlas", role: "Research", avatar: { color: "#168b75", shape: "round", expression: "curious", motion: "still" },
    hostId: "execution-offline", stateReady: true, legacyHomeProjectId: null, linkedProjectIds: ["project-user"],
    mainThreadId: "main-original", hiddenUntilActivity: false, hiddenAt: null, sectionId: null, order: 0,
    soul: "You are Atlas.\n", agents: "Legacy operating guidance.", memory: "- Cached own fact\n", settings: { concise: true },
    stateHashes: { ...EMPTY_HASHES }, updatedAt: 1, legacyProjectId: "legacy-original", ...overrides,
  };
}
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function outsideDirectory() {
  const path = mkdtempSync(join(tmpdir(), "bots-outside-"));
  cleanups.push(() => rmSync(path, { recursive: true, force: true }));
  writeFileSync(join(path, "sentinel"), "not bot state");
  return path;
}
function fixture() {
  const files = new Map<string, string>();
  let offline = false;
  let beforeRead: ((file: string) => void | Promise<void>) | undefined;
  const base64 = new Set<string>();
  const host = createFakePluginHost({ pluginId: "bots-sidebar", dataDir: "/not-the-sdk-database-location", sdk: {
    files: { read: async ({ hostId, path }) => {
      if (offline) throw new Error("Execution machine offline");
      await beforeRead?.(path);
      const content = files.get(`${hostId}:${path}`);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return { content: base64.has(path) ? Buffer.from(content).toString("base64") : content, contentEncoding: base64.has(path) ? "base64" : "utf8", sha256: hash(content), sizeBytes: Buffer.byteLength(content) };
    } },
  } });
  cleanups.push(() => host.harness.lifecycle.dispose());
  const store = createBotStore(host.bb);
  const publish = vi.fn();
  const state = createPrivateBotState(host.bb, store, publish);
  function seedLegacy(overrides: Partial<BotMetadata> = {}, path = "/legacy/atlas", homeProjectId: string | null = "old-home") {
    const { stateReady: _ready, legacyHomeProjectId: _home, ...cached } = bot(overrides);
    const legacy = { ...cached, homePath: path, homeProjectId };
    // Seed the actual v2 row, so BotStore's real decode/save source capture runs.
    host.bb.storage.database().prepare("INSERT INTO bots(id,data) VALUES (?,?)").run(legacy.id, JSON.stringify(legacy));
    return store.require(legacy.id);
  }
  function source(current = bot(), root = "/legacy/atlas") {
    files.set(`${current.hostId}:${root}/bot.json`, JSON.stringify({ version: 2, id: current.id }));
    for (const file of legacyStateFiles) files.set(`${current.hostId}:${root}/${file}`, stateContent(current, file));
  }
  return { ...host, store, publish, state, files, base64, seedLegacy, source,
    setOffline(value: boolean) { offline = value; }, setBeforeRead(callback: typeof beforeRead) { beforeRead = callback; },
  };
}

function expectDocument(result: { botId: string; file: BotStateFile; content: string; sha256: string }, content: string) {
  expect(result).toEqual({ botId: "bot_atlas", file: result.file, content, sha256: hash(content) });
  expect(Object.keys(result).sort()).toEqual(["botId", "content", "file", "sha256"]);
}

describe("private SQLite bot state", () => {
  it("exports new ready bots under the SDK DB, offline, without any SDK project/host/file calls", async () => {
    const f = fixture();
    f.setOffline(true);
    f.store.save(bot());
    const prepared = await f.state.prepare("bot_atlas");
    expect(f.state.refresh).toBe(f.state.prepare);
    const directory = f.state.directory(prepared.id);
    expect(directory).toBe(join(dirname(f.store.databasePath), "state", prepared.id));
    expect(readFileSync(f.store.databasePath).subarray(0, 16).toString()).toBe("SQLite format 3\0");
    expect(lstatSync(dirname(directory)).mode & 0o777).toBe(0o700);
    expect(lstatSync(directory).mode & 0o777).toBe(0o700);
    for (const file of ["bot.json", ...stateFiles]) {
      expect(lstatSync(join(directory, file)).mode & 0o777).toBe(0o600);
    }
    const marker = JSON.parse(readFileSync(join(directory, "bot.json"), "utf8"));
    expect(marker).toMatchObject({ version: 3, id: prepared.id, stateReady: true });
    expect(marker).not.toHaveProperty("homePath");
    expect(marker).not.toHaveProperty("homeProjectId");
    for (const file of stateFiles) {
      const content = stateContent(prepared, file);
      expect(readFileSync(join(directory, file), "utf8")).toBe(content);
      expectDocument(await f.state.read(prepared, file), content);
      expect(prepared.stateHashes[file]).toBe(hash(content));
    }
    const written = await f.state.update(prepared.id, "MEMORY.md", "- Works offline\n", hash(prepared.memory));
    expectDocument(written, "- Works offline\n");
    expect(f.harness.inspection.sdk.calls).toEqual([]);
    expect(f.state.warnings()).toEqual([]);
    expect(f.publish).toHaveBeenCalled();
    expect(readdirSync(directory).sort()).toEqual(["bot.json", ...stateFiles].sort());
  });

  it("repairs every null/stale hash on ready rows, then keeps an unchanged revision stable", async () => {
    const f = fixture();
    const current = f.store.save(bot({ stateHashes: { "SOUL.md": hash("obsolete"), "AGENTS.md": null, "MEMORY.md": hash("obsolete"), "settings.json": null } }));
    const prepared = await f.state.prepare(current.id);
    for (const file of stateFiles) expect(prepared.stateHashes[file]).toBe(hash(stateContent(prepared, file)));
    expect(prepared.updatedAt).toBeGreaterThan(current.updatedAt);
    f.publish.mockClear();
    expect(await f.state.prepare(current.id)).toEqual(prepared);
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.harness.inspection.sdk.calls).toEqual([]);
  });

  it("never trusts manual export edits or a stale metadata snapshot, and survives reopening SQLite", async () => {
    const f = fixture();
    const stale = f.store.save(bot());
    await f.state.prepare(stale.id);
    const path = join(f.state.directory(stale.id), "MEMORY.md");
    writeFileSync(path, "manual export edit");
    expectDocument(await f.state.read(stale, "MEMORY.md"), stale.memory);
    await f.state.update(stale.id, "MEMORY.md", "- Canonical DB write\n", hash(stale.memory));
    expectDocument(await f.state.read(stale, "MEMORY.md"), "- Canonical DB write\n");
    f.bb.storage.database().close();
    const reopened = createBotStore(f.bb);
    const state = createPrivateBotState(f.bb, reopened, f.publish);
    writeFileSync(path, "another manual edit");
    await state.refresh(stale.id);
    await state.mirror(stale);
    expect(reopened.require(stale.id).memory).toBe("- Canonical DB write\n");
    expect(readFileSync(path, "utf8")).toBe("- Canonical DB write\n");
    expectDocument(await state.read(stale, "MEMORY.md"), "- Canonical DB write\n");
    expect(f.harness.inspection.sdk.calls).toEqual([]);
  });

  it("CASes canonical bytes atomically across state instances and preserves fresh unrelated fields", async () => {
    const f = fixture();
    const stale = f.store.save(bot());
    await f.state.prepare(stale.id);
    f.store.mutate(stale.id, (current) => ({ ...current, name: "New name", mainThreadId: "main-new", linkedProjectIds: ["project-new"], soul: "Current identity" }));
    const second = createPrivateBotState(f.bb, f.store, f.publish);
    const results = await Promise.allSettled([
      f.state.update(stale.id, "MEMORY.md", "first writer", hash(stale.memory)),
      second.update(stale.id, "MEMORY.md", "stale second writer", hash(stale.memory)),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    if (results[1].status === "rejected") expect(results[1].reason).toBeInstanceOf(BotStateConflictError);
    expect(f.store.require(stale.id)).toMatchObject({ name: "New name", mainThreadId: "main-new", linkedProjectIds: ["project-new"], soul: "Current identity", memory: "first writer" });
    expect(f.store.require(stale.id).updatedAt).toBeGreaterThan(stale.updatedAt);
    await expect(f.state.update(stale.id, "SOUL.md", "stale identity", hash(stale.soul))).rejects.toThrow(BotStateConflictError);
    expectDocument(await f.state.read(stale, "SOUL.md"), "Current identity");
    // A stale stored hash must not authorize stale whole-file bytes either.
    f.store.mutate(stale.id, (current) => ({ ...current, stateHashes: { ...current.stateHashes, "MEMORY.md": hash(stale.memory) } }));
    await expect(f.state.update(stale.id, "MEMORY.md", "lost update", hash(stale.memory))).rejects.toThrow(BotStateConflictError);
    expect(readFileSync(join(f.state.directory(stale.id), "MEMORY.md"), "utf8")).toBe("first writer");
  });

  it("canonicalizes settings and validates document limits/JSON before committing", async () => {
    const f = fixture();
    const current = f.store.save(bot());
    await f.state.prepare(current.id);
    const result = await f.state.update(current.id, "settings.json", '{"theme":"dark","nested":{"ok":true}}', hash(stateContent(current, "settings.json")));
    const canonical = '{\n  "theme": "dark",\n  "nested": {\n    "ok": true\n  }\n}\n';
    expectDocument(result, canonical);
    expect(f.store.require(current.id).stateHashes["settings.json"]).toBe(hash(canonical));
    const before = f.store.require(current.id);
    for (const [file, content] of [
      ["SOUL.md", "x".repeat(4097)], ["MEMORY.md", "x".repeat(3001)],
      ["settings.json", "{"], ["settings.json", "[]"], ["settings.json", "null"], ["settings.json", "1"], ["settings.json", '{"v":1e999}'],
      ["settings.json", JSON.stringify({ x: "x".repeat(16385) })],
    ] as const) await expect(f.state.update(current.id, file, content, hash(stateContent(before, file)))).rejects.toThrow();
    expect(f.store.require(current.id)).toEqual(before);
    expectDocument(await f.state.read(current, "settings.json"), canonical);
    expect(applyState(current, "SOUL.md", "x".repeat(4096)).soul).toHaveLength(4096);
    expect(applyState(current, "MEMORY.md", "x".repeat(3000)).memory).toHaveLength(3000);
  });


});

describe("one-time read-only v2 import", () => {
  it("imports the latest owned source once, preserves fresh metadata, and captures the source on save", async () => {
    const f = fixture();
    const cached = f.seedLegacy();
    f.source(bot({ soul: "Latest legacy soul", memory: "- Latest legacy memory\n", settings: { imported: true } }));
    f.base64.add("/legacy/atlas/MEMORY.md");
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    f.setBeforeRead(async (path) => { if (path.endsWith("settings.json")) { entered(); await gate; } });
    const originalFiles = [...f.files];
    const preparing = f.state.prepare(cached.id);
    expect(f.state.prepare(cached.id)).toBe(preparing);
    await waiting;
    f.store.mutate(cached.id, (current) => ({ ...current, name: "Renamed while importing", mainThreadId: "main-new", sectionId: "section-new", linkedProjectIds: ["new-link"] }));
    release();
    const prepared = await preparing;
    expect(prepared).toMatchObject({ stateReady: true, legacyHomeProjectId: "old-home", name: "Renamed while importing", mainThreadId: "main-new", sectionId: "section-new", linkedProjectIds: ["new-link"], soul: "Latest legacy soul", memory: "- Latest legacy memory\n", settings: { imported: true } });
    expect(f.store.legacySource(cached.id)).toEqual({ hostId: cached.hostId, path: "/legacy/atlas", homeProjectId: "old-home" });
    expect(f.store.state(`legacy-record:${cached.id}`)).toMatchObject({ homePath: "/legacy/atlas", homeProjectId: "old-home" });
    expect([...f.files]).toEqual(originalFiles);
    const calls = f.harness.inspection.sdk.callsTo("files.read");
    expect(calls).toHaveLength(6);
    expect(calls[0][0]).toEqual({ hostId: cached.hostId, rootPath: "/legacy/atlas", path: "/legacy/atlas/bot.json" });
    expect(f.harness.inspection.sdk.calls).toHaveLength(calls.length);
    await f.state.update(cached.id, "MEMORY.md", "- New private fact\n", hash(prepared.memory));
    f.source(bot({ memory: "Do not reimport this" }));
    const recreated = createPrivateBotState(f.bb, f.store, f.publish);
    await recreated.prepare(cached.id);
    expect(f.store.require(cached.id).memory).toBe("- New private fact\n");
    expect(f.harness.inspection.sdk.callsTo("files.read")).toHaveLength(6);
    expect(recreated.warnings()).toEqual([]);
  });

  it.each(["offline", "missing", "wrong-id", "wrong-version", "bad-marker", "bad-settings", "oversized", "partial", "tilde-uninitialized", "no-source"])("uses only this bot's cached state for %s, marks ready, and never retries later", async (failure) => {
    const f = fixture();
    const cached = failure === "no-source" ? f.store.save(bot({ stateReady: false })) : f.seedLegacy({}, failure === "tilde-uninitialized" ? "~/bots/uninitialized" : "/legacy/atlas", failure === "tilde-uninitialized" ? null : "old-home");
    f.source(bot({ soul: "External soul must not partially import", memory: "External memory", settings: { fromSource: true } }));
    const marker = `${cached.hostId}:/legacy/atlas/bot.json`;
    if (failure === "offline") f.setOffline(true);
    if (failure === "missing") f.files.clear();
    if (failure === "wrong-id") f.files.set(marker, JSON.stringify({ version: 2, id: "bot_someone_else" }));
    if (failure === "wrong-version") f.files.set(marker, JSON.stringify({ version: 3, id: cached.id }));
    if (failure === "bad-marker") f.files.set(marker, "broken");
    if (failure === "bad-settings") f.files.set(`${cached.hostId}:/legacy/atlas/settings.json`, "[]");
    if (failure === "oversized") f.files.set(`${cached.hostId}:/legacy/atlas/MEMORY.md`, "x".repeat(16385));
    if (failure === "partial") f.files.delete(`${cached.hostId}:/legacy/atlas/AGENTS.md`);
    const sourceBefore = [...f.files];
    const prepared = await f.state.prepare(cached.id);
    expect(prepared.stateReady).toBe(true);
    for (const file of stateFiles) expectDocument(await f.state.read(cached, file), stateContent(cached, file));
    expect([...f.files]).toEqual(sourceBefore);
    expect(f.state.warnings()).toHaveLength(1);
    expect(f.state.warnings()[0]).toContain("cached SQLite state");
    expect(f.state.warnings()[0]).not.toContain("/legacy");
    expect(f.store.state(`private-state-warning:${cached.id}`)).toBeTruthy();
    expect(f.harness.inspection.logEntries.some((entry) => entry.level === "warn")).toBe(true);
    const calls = f.harness.inspection.sdk.callsTo("files.read");
    if (["wrong-id", "wrong-version", "bad-marker"].includes(failure)) {
      expect(calls).toHaveLength(1);
      expect((calls[0][0] as { path: string }).path).toBe("/legacy/atlas/bot.json");
    }
    expect(f.harness.inspection.sdk.calls).toHaveLength(calls.length);
    f.setOffline(false);
    f.source(bot({ memory: "Recovered source, now obsolete" }));
    await f.state.update(cached.id, "MEMORY.md", "- Private after fallback\n", hash(cached.memory));
    const recreated = createPrivateBotState(f.bb, f.store, f.publish);
    await recreated.refresh(cached.id);
    expect(f.harness.inspection.sdk.callsTo("files.read")).toHaveLength(calls.length);
    expect(f.store.require(cached.id).memory).toBe("- Private after fallback\n");
    expect(recreated.warnings()).toHaveLength(1);
  });

  it("discards an import if ownership changes during the read", async () => {
    const f = fixture();
    const cached = f.seedLegacy();
    f.source(bot({ memory: "Must not import" }));
    f.setBeforeRead((path) => {
      if (path.endsWith("settings.json")) f.files.set(`${cached.hostId}:/legacy/atlas/bot.json`, JSON.stringify({ version: 2, id: "other-bot" }));
    });
    const result = await f.state.prepare(cached.id);
    expect(result.memory).toBe(cached.memory);
    expect(result.stateReady).toBe(true);
    expect(f.state.warnings()).toHaveLength(1);
  });

  it("does not overwrite a concurrent private initialization with a slow legacy import", async () => {
    const f = fixture();
    const cached = f.seedLegacy();
    f.source(bot({ memory: "Slow source" }));
    f.setBeforeRead((path) => {
      if (path.endsWith("settings.json")) f.store.mutate(cached.id, (current) => ({ ...current, stateReady: true, memory: "Private winner", name: "Current name" }));
    });
    const prepared = await f.state.prepare(cached.id);
    expect(prepared).toMatchObject({ memory: "Private winner", name: "Current name", stateReady: true });
    expect(readFileSync(join(f.state.directory(cached.id), "MEMORY.md"), "utf8")).toBe("Private winner");
  });
});

describe("best-effort confined private exports", () => {
  it.each(["../other", "..", ".", "/absolute", "bot/child", "bot\\child", "bot\0suffix", "", "x".repeat(129)])("rejects unsafe bot ID %j", async (id) => {
    const f = fixture();
    expect(() => f.state.directory(id)).toThrow("Invalid bot ID");
    expect(() => f.state.prepare(id)).toThrow("Invalid bot ID");
    await expect(f.state.update(id, "MEMORY.md", "x", hash(""))).rejects.toThrow("Invalid bot ID");
    expect(existsSync(join(dirname(f.store.databasePath), "state"))).toBe(false);
  });

  it.each(["root-symlink", "root-file", "bot-symlink", "bot-file"])("refuses %s without losing durable writes or touching outside storage", async (kind) => {
    const f = fixture();
    const current = f.store.save(bot());
    const directory = f.state.directory(current.id);
    const root = dirname(directory);
    const outside = outsideDirectory();
    if (kind === "root-symlink") symlinkSync(outside, root);
    if (kind === "root-file") writeFileSync(root, "not a directory");
    if (kind.startsWith("bot-")) {
      mkdirSync(root);
      if (kind === "bot-symlink") symlinkSync(outside, directory);
      else writeFileSync(directory, "not a directory");
    }
    const result = await f.state.update(current.id, "MEMORY.md", "Durable despite blocked exports", hash(current.memory));
    expectDocument(result, "Durable despite blocked exports");
    expectDocument(await f.state.read(current, "MEMORY.md"), result.content);
    expect(f.store.require(current.id).memory).toBe(result.content);
    expect(f.state.warnings()).toHaveLength(1);
    expect(f.state.warnings()[0]).toContain("State remains saved in SQLite");
    expect(f.state.warnings()[0]).not.toContain(dirname(f.store.databasePath));
    expect(readdirSync(outside)).toEqual(["sentinel"]);
    expect(readFileSync(join(outside, "sentinel"), "utf8")).toBe("not bot state");
    await expect(f.state.prepare(current.id)).resolves.toMatchObject({ stateReady: true, memory: result.content });
    expect(f.harness.inspection.sdk.calls).toEqual([]);
    expect(f.publish).toHaveBeenCalled();
  });

  it.each(["wrong-id", "wrong-version", "bad-json", "marker-symlink", "state-symlink", "state-hardlink", "state-directory", "unmarked"])("refuses %s exports and leaves other files untouched, while SQLite commits", async (kind) => {
    const f = fixture();
    const current = f.store.save(bot());
    await f.state.prepare(current.id);
    const directory = f.state.directory(current.id);
    const marker = join(directory, "bot.json");
    const memory = join(directory, "MEMORY.md");
    const originalMemory = readFileSync(memory, "utf8");
    const outside = outsideDirectory();
    if (kind === "wrong-id") writeFileSync(marker, JSON.stringify({ version: 3, id: "bot_other" }));
    if (kind === "wrong-version") writeFileSync(marker, JSON.stringify({ version: 2, id: current.id }));
    if (kind === "bad-json") writeFileSync(marker, "{");
    if (kind === "marker-symlink") { rmSync(marker); symlinkSync(join(outside, "sentinel"), marker); }
    if (kind.startsWith("state-")) {
      const soul = join(directory, "SOUL.md");
      rmSync(soul);
      if (kind === "state-symlink") symlinkSync(join(outside, "sentinel"), soul);
      if (kind === "state-hardlink") linkSync(join(outside, "sentinel"), soul);
      if (kind === "state-directory") mkdirSync(soul);
    }
    if (kind === "unmarked") rmSync(marker);
    const result = await f.state.update(current.id, "MEMORY.md", "Committed without exports", hash(current.memory));
    expectDocument(result, "Committed without exports");
    expect(readFileSync(memory, "utf8")).toBe(originalMemory);
    expect(readFileSync(join(outside, "sentinel"), "utf8")).toBe("not bot state");
    expect(readdirSync(outside)).toEqual(["sentinel"]);
    expect(f.state.warnings()).toHaveLength(1);
    const recreated = createPrivateBotState(f.bb, f.store, f.publish);
    expect(recreated.warnings()).toEqual(f.state.warnings());
    expectDocument(await recreated.read(current, "MEMORY.md"), "Committed without exports");
    expect(readdirSync(directory).some((entry) => entry.endsWith(".tmp"))).toBe(false);
  });

  it.runIf(process.getuid?.() !== 0)("treats a real filesystem permission error as an export warning, not a failed SQLite commit", async () => {
    const f = fixture();
    const current = f.store.save(bot());
    const root = dirname(f.state.directory(current.id));
    mkdirSync(root, { mode: 0o700 });
    chmodSync(root, 0o000);
    try {
      const result = await f.state.update(current.id, "MEMORY.md", "Saved despite EACCES", hash(current.memory));
      expectDocument(result, "Saved despite EACCES");
      expect(f.store.require(current.id).memory).toBe(result.content);
      expect(f.state.warnings()).toHaveLength(1);
    } finally { chmodSync(root, 0o700); }
    await f.state.prepare(current.id);
    expect(readFileSync(join(f.state.directory(current.id), "MEMORY.md"), "utf8")).toBe("Saved despite EACCES");
    expect(f.state.warnings()).toEqual([]);
  });

  it("recovers exports from SQLite and clears only the export warning, preserving source warnings", async () => {
    const f = fixture();
    const current = f.seedLegacy();
    const directory = f.state.directory(current.id);
    const root = dirname(directory);
    writeFileSync(root, "blocked exports");
    await f.state.prepare(current.id);
    expect(f.state.warnings()).toHaveLength(2);
    await f.state.update(current.id, "MEMORY.md", "Committed while blocked", hash(current.memory));
    rmSync(root);
    await f.state.prepare(current.id);
    expect(readFileSync(join(directory, "MEMORY.md"), "utf8")).toBe("Committed while blocked");
    expect(f.state.warnings()).toHaveLength(1);
    expect(f.state.warnings()[0]).toContain("cached SQLite state");
    chmodSync(directory, 0o755);
    chmodSync(join(directory, "MEMORY.md"), 0o644);
    await f.state.mirror(current);
    expect(lstatSync(directory).mode & 0o777).toBe(0o700);
    expect(lstatSync(join(directory, "MEMORY.md")).mode & 0o777).toBe(0o600);
  });
});

it("imports oversized legacy memory without trimming it and preserves retired AGENTS exports", async () => {
  const f = fixture();
  const legacy = f.seedLegacy();
  f.source(bot({ memory: "L".repeat(8000), agents: "Archived custom guidance" }));
  const prepared = await f.state.prepare(legacy.id);
  expect(prepared).toMatchObject({ memory: "L".repeat(8000), agents: "Archived custom guidance" });
  const directory = f.state.directory(legacy.id);
  const archive = join(directory, "AGENTS.md");
  writeFileSync(archive, "Previously exported custom guidance", { mode: 0o600 });
  const before = readFileSync(archive, "utf8");
  const read = await f.state.read(prepared, "MEMORY.md");
  expect(read.content).toHaveLength(8000);
  await f.state.update(prepared.id, "MEMORY.md", "Condensed", read.sha256);
  expect(readFileSync(archive, "utf8")).toBe(before);
  expect(f.store.require(prepared.id).agents).toBe("Archived custom guidance");
});
