import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { avatarSchema, type BotMetadata, type BotSection } from "../contract";
import { paletteColorForSeed } from "./appearance";
import { EMPTY_HASHES, type BotStore } from "./bot-store";
const legacyFile = (root: string, name: string) => `${root.replace(/\/+$/, "")}/${name}`;

const LEGACY_KEY = "project-bots-v1";
const LEGACY_SECTIONS = "project-bot-sections-v1";
type Snapshot = { projectIds: string[]; done: string[]; capturedAt: number };
function isMissing(error: unknown) {
  return error instanceof Error && /ENOENT|no such file or directory|file not found|path (?:does not exist|not found)/i.test(error.message);
}
export function createLegacyImporter(bb: BbPluginApi, store: BotStore) {
  let inFlight: Promise<string[]> | null = null;
  async function readText(hostId: string, path: string, file: string) {
    try {
      const result = await bb.sdk.files.read({ hostId, rootPath: path, path: legacyFile(path, file) });
      return result.contentEncoding === "utf8" ? result.content : Buffer.from(result.content, "base64").toString("utf8");
    } catch (error) { if (isMissing(error)) return null; throw error; }
  }
  async function run() {
    const projects = await bb.sdk.projects.list();
    if (store.state("sections") === null) store.saveSections((await bb.storage.kv.get<BotSection[]>(LEGACY_SECTIONS)) ?? []);
    let snapshot = store.state<Snapshot>("legacy-snapshot");
    if (!snapshot) {
      snapshot = { projectIds: projects.filter((project) => project.kind === "standard").map((project) => project.id), done: [], capturedAt: Date.now() };
      store.setState("legacy-snapshot", snapshot);
    }
    const legacy = (await bb.storage.kv.get<Record<string, Partial<BotMetadata>>>(LEGACY_KEY)) ?? {};
    const warnings: string[] = [];
    for (const projectId of snapshot.projectIds.filter((id) => !snapshot.done.includes(id))) {
      const project = projects.find((project) => project.id === projectId);
      if (!project) { snapshot.done.push(projectId); store.setState("legacy-snapshot", snapshot); continue; }
      try {
        let bot = store.list().find((bot) => bot.legacyProjectId === projectId);
        if (!bot) {
          const source = project.sources.find((source) => source.isDefault) ?? project.sources[0];
          if (!source) throw new Error("No project source is available");
          const raw = await readText(source.hostId, source.path, "bot.json");
          const disk = raw === null ? legacy[projectId] : JSON.parse(raw);
          // A new BB project is not a bot. Only import real v1 records from
          // the first migration snapshot, never every project on each refresh.
          if (!disk || (raw !== null && disk.version !== 1)) {
            snapshot.done.push(projectId); store.setState("legacy-snapshot", snapshot); continue;
          }
          const id = `bot_${createHash("sha256").update(projectId).digest("hex").slice(0, 16)}`;
          const soul = (await readText(source.hostId, source.path, "SOUL.md")) ?? disk.soul ?? "";
          const defaultColor = paletteColorForSeed(id);
          const avatar = avatarSchema.parse(disk.avatar ?? { color: defaultColor, shape: "round", expression: "curious", motion: "calm" });
          bot = store.save({
            id, name: project.name, role: disk.role ?? "Project assistant", avatar,
            hostId: source.hostId, stateReady: true, legacyHomeProjectId: null, linkedProjectIds: [projectId],
            mainThreadId: disk.mainThreadId ?? null,
            hiddenUntilActivity: Boolean(disk.hiddenUntilActivity || (!disk.mainThreadId && !disk.awaitingMain)),
            hiddenAt: disk.hiddenAt ?? ((!disk.mainThreadId && !disk.awaitingMain) ? Date.now() : null),
            sectionId: disk.sectionId ?? null, order: disk.order ?? store.list().length,
            soul, agents: "", memory: "", settings: {}, stateHashes: { ...EMPTY_HASHES }, updatedAt: Date.now(), legacyProjectId: projectId,
          });
        }
        // Preserve both live and archived history, with explicit associations.
        // Import only the snapshot's existing conversations, not future project work.
        let previous: Set<string> | null = null;
        let reconciled = false;
        // Offset pages are mutable: archival can shift an unseen row behind the
        // cursor. Reconcile full live+archived passes until two agree, and leave
        // busy histories retryable instead of permanently marking a partial scan.
        for (let pass = 0; pass < 4; pass++) {
          const seen = new Set<string>();
          for (const archived of [false, true]) {
            let offset = 0;
            while (true) {
              const threads = await bb.sdk.threads.list({ projectId, archived, includeHidden: true, limit: 100, offset });
              for (const thread of threads) {
                if (thread.createdAt > snapshot.capturedAt) continue;
                seen.add(thread.id);
                if (!store.owner(thread.id)) store.bind(thread.id, bot.id);
              }
              if (threads.length < 100) break;
              offset += threads.length;
            }
          }
          if (previous && previous.size === seen.size && [...seen].every((id) => previous!.has(id))) { reconciled = true; break; }
          previous = seen;
        }
        if (!reconciled) throw new Error("Conversation history is still changing; migration needs another reconciliation pass");
        snapshot.done.push(projectId);
        store.setState("legacy-snapshot", snapshot);
      } catch (error) {
        warnings.push(`Could not import ${project.name}: ${error instanceof Error ? error.message : String(error)}. It will be retried; the project was not changed.`);
      }
    }
    return warnings;
  }
  return () => {
    if (!inFlight) inFlight = run().finally(() => { inFlight = null; });
    return inFlight;
  };
}
