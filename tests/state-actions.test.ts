import { afterEach, expect, it, vi } from "vitest";
import { backend, hash, PERSONAL_ID, project, request } from "./backend-fixture";
import { memoryFacts, mutateStateDocument } from "../lib/state-actions";
import { applyState, stateContent } from "../lib/private-state";
import type { BotStore } from "../lib/bot-store";
import type { BotStateFile } from "../contract";

const racing = vi.hoisted(() => ({ update: null as ((store: BotStore, id: string, file: BotStateFile) => void) | null }));
vi.mock("../lib/private-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/private-state")>();
  return { ...actual, createPrivateBotState: (...args: Parameters<typeof actual.createPrivateBotState>) => {
    const state = actual.createPrivateBotState(...args);
    return { ...state, update: (...input: Parameters<typeof state.update>) => {
      racing.update?.(args[1], input[0], input[1]);
      return state.update(...input);
    } };
  } };
});
function concurrentState(store: BotStore, id: string, file: BotStateFile, content: string) {
  store.mutate(id, (bot) => {
    const next = applyState(bot, file, content);
    return { ...next, stateHashes: { ...next.stateHashes, [file]: hash(stateContent(next, file)) }, updatedAt: bot.updatedAt + 1 };
  });
}

const hosts: Awaited<ReturnType<typeof backend>>[] = [];
afterEach(async () => { racing.update = null; await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose())); });
async function scope() {
  const host = await backend([project(), project("other")]); hosts.push(host);
  const bot = await host.create();
  const { threadId } = await host.harness.behavior.callRpc("conversation_create", { botId: bot.id, request: request() }) as { threadId: string };
  const ctx = { threadId, projectId: "project" };
  const read = async (target: string) => JSON.parse(await host.harness.behavior.callAgentTool("bot_read_state", { target }, ctx) as string);
  const update = async (change: unknown) => JSON.parse(await host.harness.behavior.callAgentTool("bot_update_state", change, ctx) as string);
  return { host, bot, read, update };
}

it("exposes object-root native schemas with target/action required", async () => {
  const { host } = await scope();
  const tools = host.harness.inspection.registrations.agentTools;
  expect(tools.map((tool) => tool.name)).toEqual(["bot_read_state", "bot_update_state"]);
  for (const tool of tools) expect((tool.inputSchema as { type: string }).type).toBe("object");
  expect((tools[1]!.inputSchema as { required: string[] }).required).toEqual(expect.arrayContaining(["target", "action"]));
  expect((tools[0]!.inputSchema as { properties: object }).properties).not.toHaveProperty("file");
});

it("accepts provider-supplied nulls for unused fields without treating them as edits", async () => {
  const { update, read } = await scope();
  const unused = { expectedRevision: null, name: null, role: null, soul: null, content: null, expectedSha256: null, values: null, keys: null, projectId: null };
  const result = await update({ target: "memory", action: "append", fact: "A real-provider fact.", ...unused });
  expect(result.state.facts).toEqual(["A real-provider fact."]);
  await update({ ...unused, target: "settings", action: "set", fact: null, values: { nullablePreference: null } });
  expect((await read("settings")).state.values).toEqual({ nullablePreference: null });
});

it("appends, deduplicates, and forgets exact memory facts", async () => {
  const { bot, read, update } = await scope();
  expect((await read("memory")).state.facts).toEqual([]);
  const first = await update({ target: "memory", action: "append", fact: "Prefer small changes." });
  expect(first).toMatchObject({ botId: bot.id, target: "memory", changed: true });
  expect(first.state.facts).toEqual(["Prefer small changes."]);
  expect((await update({ target: "memory", action: "append", fact: "Prefer small changes." })).changed).toBe(false);
  await update({ target: "memory", action: "append", fact: "Prefer small changes. Review them carefully." });
  const forgotten = await update({ target: "memory", action: "forget", fact: "Prefer small changes." });
  expect(forgotten.state.facts).toEqual(["Prefer small changes. Review them carefully."]);
  expect((await update({ target: "memory", action: "forget", fact: "Missing fact." })).changed).toBe(false);
});

it("preserves freeform notes and original line endings when forgetting facts", () => {
  const text = "# Memory\r\n\r\nA freeform note.\r\n- One fact.\r\n- One fact. More detail.\r\n";
  const next = mutateStateDocument(text, { target: "memory", action: "forget", fact: "One fact." });
  expect(next).toBe("# Memory\r\n\r\nA freeform note.\r\n- One fact. More detail.\r\n");
  expect(memoryFacts(next)).toEqual(["One fact. More detail."]);
});

it("retries semantic memory edits against newer bytes without losing unrelated facts", async () => {
  const { host, bot, update } = await scope(); let raced = false;
  racing.update = (store, id, file) => { if (!raced && file === "MEMORY.md") { raced = true; concurrentState(store, id, file, "- Concurrent fact.\n"); } };
  const result = await update({ target: "memory", action: "append", fact: "My fact." });
  expect(result.state.facts).toEqual(["Concurrent fact.", "My fact."]);
  expect(host.store.require(bot.id).memory).toBe("- Concurrent fact.\n- My fact.\n");
});

it("bounds retries when an external writer keeps changing state", async () => {
  const { host, update } = await scope(); let writes = 0;
  racing.update = (store, id, file) => { if (file === "MEMORY.md") concurrentState(store, id, file, `- Concurrent ${++writes}.\n`); };
  await expect(update({ target: "memory", action: "append", fact: "My fact." })).rejects.toThrow(/changed/);
  expect(writes).toBe(3);
});

it("sets/unsets only selected settings and preserves concurrent keys", async () => {
  const { host, bot, read, update } = await scope();
  await update({ target: "settings", action: "set", values: { style: "concise", timezone: "UTC", nested: { enabled: true } } });
  let raced = false;
  racing.update = (store, id, file) => {
    if (!raced && file === "settings.json") {
      raced = true;
      concurrentState(store, id, file, JSON.stringify({ style: "concise", timezone: "UTC", nested: { enabled: true }, concurrent: 42 }));
    }
  };
  const changed = await update({ target: "settings", action: "set", values: { style: "detailed", optional: null } });
  expect(changed.state.values).toEqual({ style: "detailed", timezone: "UTC", nested: { enabled: true }, concurrent: 42, optional: null });
  const removed = await update({ target: "settings", action: "unset", keys: ["style", "absent"] });
  expect(removed.state.values).toEqual({ timezone: "UTC", nested: { enabled: true }, concurrent: 42, optional: null });
  expect((await update({ target: "settings", action: "unset", keys: ["absent"] })).changed).toBe(false);
  expect((await read("settings")).state.values).toEqual(host.store.require(bot.id).settings);
});

it("requires a fresh revision for identity and never renames linked projects", async () => {
  const { host, bot, read, update } = await scope();
  const identity = await read("identity");
  const result = await update({ target: "identity", action: "set", expectedRevision: identity.revision, name: "Orion", soul: "A careful collaborator." });
  expect(result.state).toMatchObject({ name: "Orion", soul: "A careful collaborator.", role: "Research" });
  expect(host.store.require(bot.id).soul).toBe("A careful collaborator.");
  expect(host.harness.inspection.sdk.callsTo("projects.update")).toEqual([]);
  await expect(update({ target: "identity", action: "set", expectedRevision: identity.revision, role: "Stale edit" })).rejects.toThrow(/Identity changed/);
  const latest = await read("identity");
  expect((await update({ target: "identity", action: "set", expectedRevision: latest.revision, name: "Orion" })).changed).toBe(false);
});

it("joins/leaves projects without moving projects, files, or existing conversations", async () => {
  const { host, bot, read, update } = await scope();
  const initial = await read("project");
  expect(initial.state.available.map((project: { id: string }) => project.id)).toEqual(["project", "other"]);
  const joined = await update({ target: "project", action: "join", projectId: "other" });
  expect(joined.state.linked.map((project: { id: string }) => project.id)).toEqual(["project", "other"]);
  expect((await update({ target: "project", action: "join", projectId: "other" })).changed).toBe(false);
  const left = await update({ target: "project", action: "leave", projectId: "project" });
  expect(left.state.linked.map((project: { id: string }) => project.id)).toEqual(["other"]);
  expect((await update({ target: "project", action: "leave", projectId: "project" })).changed).toBe(false);
  expect(host.harness.inspection.sdk.callsTo("projects.create")).toHaveLength(0);
  expect(host.harness.inspection.sdk.callsTo("projects.update")).toEqual([]);
  expect((await read("memory")).botId).toBe(bot.id); // Existing conversation keeps its bot.
  await expect(update({ target: "project", action: "join", projectId: PERSONAL_ID })).rejects.toThrow(/existing work project/);
});

it("limits mutations to the current bot and rejects invalid target/action shapes", async () => {
  const { host, bot, update } = await scope(); const other = await host.create("Nova");
  for (const change of [
    { action: "append", fact: "x" },
    { target: "routine", action: "create" },
    { target: "memory", action: "set", fact: "x" },
    { target: "memory", action: "append", fact: "one\ntwo" },
    { target: "identity", action: "set", name: "No revision" },
    { target: "settings", action: "set", values: {} },
    { target: "settings", action: "set", values: JSON.parse('{"__proto__": {"polluted":true}}') },
    { target: "project", action: "join" },
    { target: "memory", action: "append", fact: "x", botId: other.id },
  ]) await expect(update(change)).rejects.toThrow();
  await update({ target: "memory", action: "append", fact: "Only Atlas knows this." });
  expect(host.store.require(bot.id).memory).toContain("Only Atlas knows this.");
  expect(host.store.require(other.id).memory).toBe("");
});

it("allows exactly 3000 memory characters and rejects overflow with compaction instructions", async () => {
  const { bot, host, read, update } = await scope();
  const first = await update({ target: "memory", action: "overwrite", content: "x".repeat(2995), expectedSha256: (await read("memory")).state.sha256 });
  expect(first.state.characters).toBe(2995);
  const full = await update({ target: "memory", action: "append", fact: "a" }); // newline + '- a\n'
  expect(full.state).toMatchObject({ characters: 3000, maxCharacters: 3000 });
  const before = host.store.require(bot.id);
  await expect(update({ target: "memory", action: "append", fact: "b" })).rejects.toThrow(/3000.*bot_read_state.*overwrite.*expectedSha256/);
  expect(host.store.require(bot.id)).toEqual(before);
  await expect(update({ target: "memory", action: "overwrite", content: "x".repeat(3001), expectedSha256: full.state.sha256 })).rejects.toThrow(/3000.*bot_read_state.*overwrite/);
  expect(host.store.require(bot.id)).toEqual(before);
});

it("overwrites only the memory read, supports clearing, and requires a fresh hash", async () => {
  const { read, update } = await scope();
  const old = await read("memory");
  await update({ target: "memory", action: "append", fact: "Newer fact" });
  await expect(update({ target: "memory", action: "overwrite", content: "Lost fact", expectedSha256: old.state.sha256 })).rejects.toThrow(/Memory changed.*bot_read_state/);
  await expect(update({ target: "memory", action: "overwrite", content: "Missing hash" })).rejects.toThrow(/expectedSha256/);
  const latest = await read("memory");
  expect((await update({ target: "memory", action: "overwrite", content: latest.state.content, expectedSha256: latest.state.sha256 })).changed).toBe(false);
  const cleared = await update({ target: "memory", action: "overwrite", content: "", expectedSha256: latest.state.sha256 });
  expect(cleared.state).toMatchObject({ content: "", characters: 0, facts: [] });
});

it("never retries a whole-memory overwrite after a concurrent write", async () => {
  const { bot, host, read, update } = await scope();
  const old = await read("memory");
  const competing = vi.fn((store, id, file) => concurrentState(store, id, file, "- Concurrent fact.\n"));
  racing.update = competing;
  await expect(update({ target: "memory", action: "overwrite", content: "Stale condensed text", expectedSha256: old.state.sha256 })).rejects.toThrow(/changed/);
  expect(competing).toHaveBeenCalledOnce();
  expect(host.store.require(bot.id).memory).toBe("- Concurrent fact.\n");
});

it("keeps oversized legacy memory readable until a compliant overwrite, without losing archived instructions", async () => {
  const { bot, host, read, update } = await scope();
  host.store.save({ ...host.store.require(bot.id), memory: "L".repeat(9000), agents: "Archived custom operating rules" });
  await host.reload();
  const legacy = await read("memory");
  expect(legacy.state).toMatchObject({ characters: 9000, maxCharacters: 3000, content: "L".repeat(9000) });
  expect((await read("identity")).state).not.toHaveProperty("agents");
  await expect(update({ target: "memory", action: "append", fact: "New fact" })).rejects.toThrow(/3000.*overwrite/);
  await update({ target: "memory", action: "overwrite", content: "- Condensed legacy memory.\n", expectedSha256: legacy.state.sha256 });
  expect(host.store.require(bot.id)).toMatchObject({ agents: "Archived custom operating rules", memory: "- Condensed legacy memory.\n" });
  await expect(update({ target: "identity", action: "set", expectedRevision: host.store.require(bot.id).updatedAt, agents: "Retired edit" })).rejects.toThrow();
});
