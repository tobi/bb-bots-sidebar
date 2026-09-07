import { afterEach, expect, it, vi } from "vitest";
import { makeMessageDispatchHookContext, makePluginAgentConfigurationContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { BotMetadata } from "../contract";
import { avatar, backend, PERSONAL_ID, project, request } from "./backend-fixture";

const hosts: Awaited<ReturnType<typeof backend>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose())); });
async function setup() { const host = await backend([project(), project("other")]); hosts.push(host); return host; }
const edit = (bot: BotMetadata) => ({ botId: bot.id, name: bot.name, role: bot.role, avatar: bot.avatar, sectionId: bot.sectionId, linkedProjectIds: bot.linkedProjectIds, soul: bot.soul, expectedUpdatedAt: bot.updatedAt, expectedStateHashes: bot.stateHashes });
async function role(host: Awaited<ReturnType<typeof backend>>, botId: string, action: string, projectId = "project") {
  return host.harness.behavior.callRpc("state_apply", { botId, change: { target: "project", action, projectId } });
}
function fresh(host: Awaited<ReturnType<typeof backend>>, id: string, overrides: Partial<ReturnType<typeof makeThreadResponse>> = {}) {
  const row = makeThreadResponse({ id, projectId: "project", status: "pending", originPluginId: null, createdAt: Date.now() + 1, ...overrides });
  host.threads.set(id, row); return row;
}
async function dispatch(host: Awaited<ReturnType<typeof backend>>, thread: ReturnType<typeof makeThreadResponse>) {
  return host.harness.inspection.registrations.hooks["message.dispatch"]!(makeMessageDispatchHookContext({ thread, project: { id: thread.projectId }, input: { blocks: [], text: "hello" } }));
}

it("routes newly created project conversations to its one owner before agent configuration", async () => {
  const host = await setup(); const bot = await host.create("Atlas", []);
  await role(host, bot.id, "own");
  expect(host.store.require(bot.id).linkedProjectIds).toEqual(["project"]);
  const thread = fresh(host, "ordinary");
  expect((await host.harness.behavior.emitThreadEvent("thread.created", { thread })).errors).toEqual([]);
  expect(host.store.owner(thread.id)).toBe(bot.id);
  const config = await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: thread.id }, project: { id: "project" } }));
  expect(config.instructions).toContain("You are Atlas.");
  expect(config.tools.map((tool) => tool.name)).toContain("bot_update_state");
  const list = await host.harness.behavior.callRpc("bots_list", null) as { projectOwners: unknown[] };
  expect(list.projectOwners).toEqual([{ projectId: "project", botId: bot.id }]);
  expect(host.store.require(bot.id).mainThreadId).toBeNull();
  expect(host.harness.inspection.sdk.callsTo("files.write")).toEqual([]);
  expect(host.harness.inspection.sdk.callsTo("projects.update")).toEqual([]);
});

it("dispatch supplies the default when the creation event has not run", async () => {
  const host = await setup(); const bot = await host.create(); await role(host, bot.id, "own");
  const thread = fresh(host, "before-event", { originPluginId: "automations" });
  await dispatch(host, thread);
  expect(host.store.owner(thread.id)).toBe(bot.id);
});

it("explicit bot starts beat the project default and join the member bot before spawning", async () => {
  const host = await setup(); const owner = await host.create("Atlas"); const member = await host.create("Nova", []);
  await role(host, owner.id, "own");
  const created = await host.harness.behavior.callRpc("conversation_create", { botId: member.id, request: request() }) as { threadId: string };
  expect(host.store.owner(created.threadId)).toBe(member.id);
  expect(host.store.require(member.id).linkedProjectIds).toEqual(["project"]);
  expect(host.store.projectOwner("project")?.botId).toBe(owner.id);
  expect(host.initialConfigurations.at(-1)?.instructions).toContain("You are Nova.");
  expect(host.initialConfigurations.at(-1)?.instructions).not.toContain("You are Atlas.");
});

it("nearest bot ancestry overrides the default even when the intermediate parent is unbound", async () => {
  const host = await setup(); const owner = await host.create("Atlas"); const member = await host.create("Nova", []);
  await role(host, owner.id, "own");
  const root = await host.harness.behavior.callRpc("conversation_create", { botId: member.id, request: request(PERSONAL_ID) }) as { threadId: string };
  fresh(host, "middle", { parentThreadId: root.threadId, projectId: PERSONAL_ID });
  const child = fresh(host, "child", { parentThreadId: "middle" });
  await host.harness.behavior.emitThreadEvent("thread.created", { thread: child });
  await dispatch(host, child);
  expect(host.store.owner(child.id)).toBe(member.id);
  expect(host.store.require(member.id).linkedProjectIds).toContain("project");
  expect(host.store.projectOwner("project")?.botId).toBe(owner.id);
});

it("a fork's bot context also beats the project default", async () => {
  const host = await setup(); const owner = await host.create("Atlas"); const member = await host.create("Nova");
  await role(host, owner.id, "own");
  const root = await host.harness.behavior.callRpc("conversation_create", { botId: member.id, request: request() }) as { threadId: string };
  const fork = fresh(host, "fork", { sourceThreadId: root.threadId, originPluginId: "side-chat" });
  await dispatch(host, fork);
  expect(host.store.owner(fork.id)).toBe(member.id);
});

it("configuration reads cannot preempt a new fork's atomic binding and membership join", async () => {
  const host = await setup(); const owner = await host.create("Atlas"); const member = await host.create("Nova", []); await role(host, owner.id, "own");
  const root = await host.harness.behavior.callRpc("conversation_create", { botId: member.id, request: request(PERSONAL_ID) }) as { threadId: string };
  const fork = fresh(host, "config-first-fork", { sourceThreadId: root.threadId, status: "idle" });
  const config = await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: fork.id, sourceThreadId: root.threadId }, project: { id: "project" } }));
  expect(config.instructions).toContain("You are Nova.");
  expect(host.store.owner(fork.id)).toBeNull();
  await host.harness.behavior.emitThreadEvent("thread.created", { thread: fork });
  expect(host.store.owner(fork.id)).toBe(member.id);
  expect(host.store.require(member.id).linkedProjectIds).toContain("project");
});

it("does not capture old history, old pending threads, or projectless conversations", async () => {
  const host = await setup(); const bot = await host.create(); await role(host, bot.id, "own");
  const since = host.store.projectOwner("project")!.assignedAt;
  const old = fresh(host, "old", { createdAt: since - 100, status: "idle" });
  const pending = fresh(host, "old-pending", { createdAt: since - 100 });
  const sameMillisecond = fresh(host, "same-ms-pending", { createdAt: since });
  const personal = fresh(host, "personal", { projectId: PERSONAL_ID });
  await dispatch(host, old); await dispatch(host, pending); await dispatch(host, sameMillisecond); await dispatch(host, personal);
  expect(host.store.owner(old.id)).toBeNull(); expect(host.store.owner(pending.id)).toBeNull(); expect(host.store.owner(sameMillisecond.id)).toBeNull(); expect(host.store.owner(personal.id)).toBeNull();
  await expect(role(host, bot.id, "own", PERSONAL_ID)).rejects.toThrow(/existing work project/);
});

it("enforces unique ownership under concurrent claims without stealing or partially saving a loser", async () => {
  const host = await setup(); const a = await host.create("Atlas"); const b = await host.create("Nova");
  const results = await Promise.allSettled([role(host, a.id, "own"), role(host, b.id, "own")]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(host.store.projectOwners()).toHaveLength(1);
  const winner = host.store.projectOwner("project")!.botId;
  const loser = host.store.require(winner === a.id ? b.id : a.id);
  await expect(host.harness.behavior.callRpc("bot_update", { ...edit(loser), name: "Must not save", soul: "Must not save", ownedProjectIds: ["project"] })).rejects.toThrow(/already owned/);
  expect(host.store.require(loser.id).name).toBe(loser.name);
  expect(host.store.require(loser.id).soul).toBe(loser.soul);
  const count = host.store.list().length;
  await expect(host.harness.behavior.callRpc("bot_create", { name: "Conflict", role: "", hostId: "host-home", avatar, sectionId: null, linkedProjectIds: ["project"], ownedProjectIds: ["project"], soul: "" })).rejects.toThrow(/already owned/);
  expect(host.store.list()).toHaveLength(count);
});

it("never steals an inconsistent ownership row; its holder must explicitly release it", async () => {
  const host = await setup(); const a = await host.create("Atlas"); const b = await host.create("Nova"); await role(host, a.id, "own");
  host.store.save({ ...host.store.require(a.id), linkedProjectIds: [] });
  expect(host.store.projectOwner("project")).toBeUndefined();
  await expect(role(host, b.id, "own")).rejects.toThrow(/already owned by Atlas/);
  await expect(host.harness.behavior.callRpc("bot_update", { ...edit(host.store.require(b.id)), ownedProjectIds: ["project"] })).rejects.toThrow(/already owned by Atlas/);
  const thread = fresh(host, "invalid-owner"); await dispatch(host, thread); expect(host.store.owner(thread.id)).toBeNull();
  await role(host, a.id, "release"); await role(host, b.id, "own");
  expect(host.store.projectOwner("project")?.botId).toBe(b.id);
});

it("release retains membership; changing owners affects only future conversations", async () => {
  const host = await setup(); const a = await host.create("Atlas"); const b = await host.create("Nova"); await role(host, a.id, "own");
  const first = fresh(host, "first"); await dispatch(host, first);
  await role(host, a.id, "release");
  expect(host.store.require(a.id).linkedProjectIds).toContain("project");
  await role(host, b.id, "own");
  const second = fresh(host, "second"); await dispatch(host, second); await dispatch(host, first);
  expect(host.store.owner(first.id)).toBe(a.id); expect(host.store.owner(second.id)).toBe(b.id);
  await role(host, b.id, "leave");
  expect(host.store.projectOwner("project")).toBeUndefined(); expect(host.store.require(b.id).linkedProjectIds).not.toContain("project");
  await dispatch(host, second);
  expect(host.store.owner(second.id)).toBe(b.id);
  expect(host.store.require(b.id).linkedProjectIds).not.toContain("project");
  const third = fresh(host, "third"); await dispatch(host, third); expect(host.store.owner(third.id)).toBeNull();
});

it("persists ownership through reload and keeps the original cutoff on unrelated editor saves", async () => {
  const host = await setup(); const bot = await host.create(); await role(host, bot.id, "own"); const since = host.store.projectOwner("project")!.assignedAt;
  vi.spyOn(Date, "now").mockReturnValue(since + 1000);
  const current = host.store.require(bot.id);
  await host.harness.behavior.callRpc("bot_update", { ...edit(current), role: "Renamed role", ownedProjectIds: ["project"] });
  expect(host.store.projectOwner("project")?.assignedAt).toBe(since);
  await host.reload();
  const queued = fresh(host, "queued", { createdAt: since + 500 }); await dispatch(host, queued);
  expect(host.store.owner(queued.id)).toBe(bot.id);
});

it("can edit identity while an already-owned project is unavailable, or explicitly unlink it", async () => {
  const host = await setup(); const bot = await host.create(); await role(host, bot.id, "own");
  host.projects.splice(host.projects.findIndex((project) => project.id === "project"), 1);
  await host.harness.behavior.callRpc("bot_update", { ...edit(host.store.require(bot.id)), name: "Still independent", ownedProjectIds: ["project"] });
  expect(host.store.require(bot.id).name).toBe("Still independent");
  expect(host.store.projectOwner("project")?.botId).toBe(bot.id);
  await host.harness.behavior.callRpc("bot_update", { ...edit(host.store.require(bot.id)), linkedProjectIds: [], ownedProjectIds: [] });
  expect(host.store.projectOwner("project")).toBeUndefined();
});

it("unlinking in the editor releases ownership and owner-without-membership is rejected", async () => {
  const host = await setup(); const bot = await host.create(); await role(host, bot.id, "own");
  await expect(host.harness.behavior.callRpc("bot_update", { ...edit(host.store.require(bot.id)), linkedProjectIds: [], ownedProjectIds: ["project"] })).rejects.toThrow(/must be linked/);
  await host.harness.behavior.callRpc("bot_update", { ...edit(host.store.require(bot.id)), linkedProjectIds: [] });
  expect(host.store.projectOwner("project")).toBeUndefined();
  expect(host.store.require(bot.id).linkedProjectIds).toEqual([]);
});

it("does not prematurely default while ancestry resolution races the first dispatch", async () => {
  const host = await setup(); const owner = await host.create("Atlas"); const member = await host.create("Nova", []); await role(host, owner.id, "own");
  const root = await host.harness.behavior.callRpc("conversation_create", { botId: member.id, request: request(PERSONAL_ID) }) as { threadId: string };
  fresh(host, "delayed-parent", { parentThreadId: root.threadId, projectId: PERSONAL_ID });
  const child = fresh(host, "racing-child", { parentThreadId: "delayed-parent" });
  let unblock!: () => void; let arrived!: () => void;
  const gate = new Promise<void>((resolve) => { unblock = resolve; });
  const started = new Promise<void>((resolve) => { arrived = resolve; });
  host.harness.inspection.sdk.stub("threads.get", async ({ threadId }: { threadId: string }) => { if (threadId === "delayed-parent") { arrived(); await gate; } return host.threads.get(threadId)!; });
  const event = host.harness.behavior.emitThreadEvent("thread.created", { thread: child });
  const sending = dispatch(host, child);
  await started;
  try { expect(host.store.owner(child.id)).toBeNull(); } finally { unblock(); }
  await Promise.all([event, sending]);
  expect(host.store.owner(child.id)).toBe(member.id);
  expect(host.store.require(member.id).linkedProjectIds).toContain("project");
});

it("rebases role changes on concurrent inherited memberships", async () => {
  const host = await setup(); const bot = await host.create("Atlas", []);
  let unblock!: () => void; let arrived!: () => void;
  const gate = new Promise<void>((resolve) => { unblock = resolve; });
  const started = new Promise<void>((resolve) => { arrived = resolve; });
  host.harness.inspection.sdk.stub("projects.list", async () => { arrived(); await gate; return host.projects; });
  const owning = role(host, bot.id, "own");
  await started;
  host.store.adoptInherited("concurrent-child", bot.id, "other"); unblock();
  await owning;
  expect(host.store.require(bot.id).linkedProjectIds.sort()).toEqual(["other", "project"]);
});

it("recovers a project-scoped explicit start after reload and unlink, without defaulting or rejoining", async () => {
  const host = await setup(); const owner = await host.create("Atlas"); const member = await host.create("Nova", []); await role(host, owner.id, "own");
  let blocks: ReturnType<typeof makeMessageDispatchHookContext>["input"]["blocks"] = [];
  const thread = fresh(host, "lost-response", { originPluginId: host.bb.pluginId });
  host.harness.inspection.sdk.stub("threads.spawn", async (args: { input?: typeof blocks }) => { blocks = args.input ?? []; await host.harness.behavior.emitThreadEvent("thread.created", { thread }); throw new Error("Response lost"); });
  await expect(host.harness.behavior.callRpc("conversation_create", { botId: member.id, request: request() })).rejects.toThrow(/Response lost/);
  expect(host.store.owner(thread.id)).toBeNull();
  await role(host, member.id, "leave"); await host.reload();
  const wrong = fresh(host, "wrong-project", { projectId: "other", originPluginId: host.bb.pluginId });
  await expect(host.harness.inspection.registrations.hooks["message.dispatch"]!(makeMessageDispatchHookContext({ thread: wrong, project: { id: "other" }, input: { blocks, text: "start" } }))).rejects.toThrow(/different project/);
  expect(host.store.owner(wrong.id)).toBeNull();
  await host.harness.inspection.registrations.hooks["message.dispatch"]!(makeMessageDispatchHookContext({ thread, project: { id: "project" }, input: { blocks, text: "start" } }));
  expect(host.store.owner(thread.id)).toBe(member.id);
  expect(host.store.projectOwner("project")?.botId).toBe(owner.id);
  expect(host.store.require(member.id).linkedProjectIds).not.toContain("project");
});

it("keeps scheduled explicit starts with their chosen bot through reload", async () => {
  const host = await setup(); const owner = await host.create("Atlas"); const member = await host.create("Nova", []); await role(host, owner.id, "own");
  const input = { ...request(), sendAt: Date.now() + 3600000 };
  const created = await host.harness.behavior.callRpc("conversation_create", { botId: member.id, request: input }) as { threadId: string };
  await host.reload(); await dispatch(host, host.threads.get(created.threadId)!);
  expect(host.store.owner(created.threadId)).toBe(member.id);
  expect(host.store.projectOwner("project")?.botId).toBe(owner.id);
});

it("supports owner claims in creation and excludes legacy homes from ownership", async () => {
  const host = await setup();
  const bot = await host.harness.behavior.callRpc("bot_create", { name: "Owner", role: "", hostId: "host-home", avatar, sectionId: null, linkedProjectIds: ["project"], ownedProjectIds: ["project"], soul: "" }) as BotMetadata;
  expect(host.store.projectOwner("project")?.botId).toBe(bot.id);
  host.projects.push(project("legacy-home")); host.store.save({ ...host.store.require(bot.id), legacyHomeProjectId: "legacy-home" });
  await expect(role(host, bot.id, "own", "legacy-home")).rejects.toThrow(/legacy bot home/);
});
