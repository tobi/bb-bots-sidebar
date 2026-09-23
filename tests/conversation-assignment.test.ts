import { afterEach, expect, it } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { backend, PERSONAL_ID, project } from "./backend-fixture";
import { listBotConversations } from "../lib/bot-conversations";

const instances: Awaited<ReturnType<typeof backend>>[] = [];
afterEach(async () => { await Promise.all(instances.splice(0).map(host => host.harness.lifecycle.dispose())); });
async function setup() { const host = await backend([project(), project("other")]); instances.push(host); return host; }
function addThread(host: Awaited<ReturnType<typeof backend>>, id: string, projectId = "project", parentThreadId: string | null = null) {
  const value = makeThreadResponse({ id, projectId, parentThreadId, createdAt: 1, title: "Private conversation", originPluginId: null }); host.threads.set(id, value); return value;
}

it.each(["project", PERSONAL_ID])("puts a dropped %s chat first durably, preserving existing order and thread data", async projectId => {
  const host = await setup(); const bot = await host.create("Target", []);
  for (const id of ["old-first", "old-second"]) { addThread(host, id, PERSONAL_ID); host.store.bind(id, bot.id); }
  host.store.mutate(bot.id, current => ({ ...current, threadOrder: ["old-second", "old-first"] }));
  addThread(host, "unassigned-parent", projectId);
  const chat = addThread(host, "chat", projectId, "unassigned-parent");
  await host.harness.behavior.callRpc("conversation_assign", { botId: bot.id, threadId: chat.id, placeFirst: true });
  await host.reload();
  const saved = host.store.require(bot.id);
  expect(saved.threadOrder).toEqual(["chat", "old-second", "old-first"]);
  expect(saved.linkedProjectIds).toEqual(projectId === PERSONAL_ID ? [] : ["project"]);
  expect(saved.mainThreadId).toBe(bot.mainThreadId);
  expect(host.threads.get(chat.id)).toEqual(chat);
  expect((await listBotConversations(host.bb, saved, async id => host.store.owner(id))).roots[0]?.id).toBe(chat.id);
  expect(host.harness.inspection.sdk.callsTo("threads.update")).toEqual([]);
});

it.each(["project", PERSONAL_ID])("appends an outside %s chat after ranked and unranked roots durably", async projectId => {
  const host = await setup(); const bot = await host.create("Target", []);
  for (const id of ["ranked", "unranked-a", "unranked-b"]) { addThread(host, id, PERSONAL_ID); host.store.bind(id, bot.id); }
  host.store.mutate(bot.id, current => ({ ...current, threadOrder: ["ranked"] }));
  const chat = addThread(host, "chat", projectId);
  const before = (await listBotConversations(host.bb, host.store.require(bot.id), async id => host.store.owner(id))).roots.map(row => row.id);
  await host.harness.behavior.callRpc("conversation_assign", { botId: bot.id, threadId: chat.id, placeFirst: false });
  await host.reload();
  const saved = host.store.require(bot.id);
  expect((await listBotConversations(host.bb, saved, async id => host.store.owner(id))).roots.map(row => row.id)).toEqual([...before, chat.id]);
  expect(saved.linkedProjectIds).toEqual(projectId === PERSONAL_ID ? [] : ["project"]);
  expect(saved.mainThreadId).toBe(bot.mainThreadId);
  expect(host.threads.get(chat.id)).toEqual(chat);
  expect(host.harness.inspection.sdk.callsTo("threads.update")).toEqual([]);
});

it("serializes append drops to an empty bot", async () => {
  const host = await setup(); const bot = await host.create("Target", []);
  for (const id of ["one", "two"]) addThread(host, id, PERSONAL_ID);
  await Promise.all(["one", "two"].map(threadId => host.harness.behavior.callRpc("conversation_assign", { botId: bot.id, threadId, placeFirst: false })));
  expect(host.store.require(bot.id).threadOrder).toEqual(["one", "two"]);
});

it("does not change ordering when ordinary dialog assignment omits placeFirst", async () => {
  const host = await setup(); const bot = await host.create(); addThread(host, "chat");
  await host.harness.behavior.callRpc("conversation_assign", { botId: bot.id, threadId: "chat" });
  expect(host.store.require(bot.id).threadOrder).toBeUndefined();
});

it("rejects promoting an archived chat without binding, joining, or ordering", async () => {
  const host = await setup(); const bot = await host.create("Target", []); const chat = addThread(host, "chat");
  host.threads.set(chat.id, { ...chat, archivedAt: 1 });
  await expect(host.harness.behavior.callRpc("conversation_assign", { botId: bot.id, threadId: chat.id, placeFirst: true })).rejects.toThrow(/Restore/);
  expect(host.store.require(bot.id)).toEqual(bot); expect(host.store.owner(chat.id)).toBeNull();
});

it("assigns an unlinked work-project chat, joins the chosen bot as Member, and changes no conversation data", async () => {
  const host = await setup(); const owner = await host.create("Owner"); const target = await host.create("Target", []);
  await host.harness.behavior.callRpc("state_apply", { botId: owner.id, change: { target: "project", action: "own", projectId: "project" } });
  const chat = addThread(host, "chat"); const before = { ...chat };
  await host.harness.behavior.callRpc("conversation_assign", { botId: target.id, threadId: chat.id });
  expect(host.store.owner(chat.id)).toBe(target.id);
  expect(host.store.require(target.id).linkedProjectIds).toEqual(["project"]);
  expect(host.store.require(target.id).mainThreadId).toBe(target.mainThreadId);
  expect(host.store.projectOwner("project")?.botId).toBe(owner.id);
  expect(host.threads.get(chat.id)).toEqual(before);
  for (const method of ["threads.update", "projects.update", "files.write"] as const) expect(host.harness.inspection.sdk.callsTo(method)).toEqual([]);
});

it("does not revive an inconsistent old ownership row while joining as Member", async () => {
  const host = await setup(); const bot = await host.create("Target");
  await host.harness.behavior.callRpc("state_apply", { botId: bot.id, change: { target: "project", action: "own", projectId: "project" } });
  host.store.save({ ...host.store.require(bot.id), linkedProjectIds: [] }); addThread(host, "chat");
  await host.harness.behavior.callRpc("conversation_assign", { botId: bot.id, threadId: "chat" });
  expect(host.store.require(bot.id).linkedProjectIds).toEqual(["project"]);
  expect(host.store.projectOwner("project")).toBeUndefined();
});

it("assigns personal chats without creating a project membership", async () => {
  const host = await setup(); const bot = await host.create("Target", []); const chat = addThread(host, "personal", PERSONAL_ID);
  await host.harness.behavior.callRpc("conversation_assign", { botId: bot.id, threadId: chat.id });
  expect(host.store.owner(chat.id)).toBe(bot.id); expect(host.store.require(bot.id).linkedProjectIds).toEqual([]);
});

it("does not steal an existing or inherited association, or change membership on a rejected request", async () => {
  const host = await setup(); const first = await host.create("First"); const second = await host.create("Second", []);
  const root = addThread(host, "root"); const child = addThread(host, "child", "project", root.id); host.store.bind(root.id, first.id);
  for (const threadId of [root.id, child.id]) await expect(host.harness.behavior.callRpc("conversation_assign", { botId: second.id, threadId })).rejects.toThrow(/another bot/);
  expect(host.store.owner(root.id)).toBe(first.id); expect(host.store.owner(child.id)).toBeNull();
  expect(host.store.require(second.id)).toEqual(second);
});

it("keeps explicit child associations when a previously unassigned parent is assigned", async () => {
  const host = await setup(); const first = await host.create("First", []); const second = await host.create("Second");
  const root = addThread(host, "root"); addThread(host, "child", "project", root.id); host.store.bind("child", second.id);
  await host.harness.behavior.callRpc("conversation_assign", { botId: first.id, threadId: root.id });
  expect(host.store.owner(root.id)).toBe(first.id); expect(host.store.owner("child")).toBe(second.id);
});

it("keeps binding and membership atomic if another owner appears during validation", async () => {
  const host = await setup(); const first = await host.create("First"); const second = await host.create("Second", []); addThread(host, "chat");
  let arrived!: () => void, release!: () => void; const started = new Promise<void>(resolve => { arrived = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  host.harness.inspection.sdk.stub("projects.list", async (args?: { includePersonal?: boolean }) => {
    if (args?.includePersonal) return [...host.projects, { ...project(PERSONAL_ID), kind: "personal", sources: [] }];
    arrived(); await gate; return host.projects;
  });
  const assigning = host.harness.behavior.callRpc("conversation_assign", { botId: second.id, threadId: "chat", placeFirst: true });
  await started; host.store.bind("chat", first.id); release();
  await expect(assigning).rejects.toThrow(/another bot/);
  expect(host.store.owner("chat")).toBe(first.id); expect(host.store.require(second.id)).toEqual(second);
});

it("serializes competing assignments without joining the losing bot", async () => {
  const host = await setup(); const first = await host.create("First", []); const second = await host.create("Second", []); addThread(host, "chat");
  const results = await Promise.allSettled([first, second].map(bot => host.harness.behavior.callRpc("conversation_assign", { botId: bot.id, threadId: "chat" })));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const winner = host.store.owner("chat");
  expect(host.store.require(winner!).linkedProjectIds).toEqual(["project"]);
  expect(host.store.require(winner === first.id ? second.id : first.id).linkedProjectIds).toEqual([]);
});

it("rejects missing projects and foreign legacy homes without altering state, but recovers a bot's own legacy chat", async () => {
  const host = await setup(); const original = await host.create("Legacy", []); const other = await host.create("Other", []);
  host.projects.push(project("legacy-home")); host.store.save({ ...original, legacyHomeProjectId: "legacy-home" });
  addThread(host, "missing", "missing"); addThread(host, "legacy", "legacy-home");
  await expect(host.harness.behavior.callRpc("conversation_assign", { botId: other.id, threadId: "missing" })).rejects.toThrow(/existing work project/);
  await expect(host.harness.behavior.callRpc("conversation_assign", { botId: other.id, threadId: "legacy" })).rejects.toThrow(/legacy bot home/);
  expect(host.store.require(other.id).linkedProjectIds).toEqual([]);
  await host.harness.behavior.callRpc("conversation_assign", { botId: original.id, threadId: "legacy" });
  expect(host.store.owner("legacy")).toBe(original.id); expect(host.store.require(original.id).linkedProjectIds).toEqual([]);
});

it("is idempotent without silently rejoining a project that was subsequently left", async () => {
  const host = await setup(); const bot = await host.create("Target", []); addThread(host, "chat");
  await host.harness.behavior.callRpc("conversation_assign", { botId: bot.id, threadId: "chat" });
  await host.harness.behavior.callRpc("state_apply", { botId: bot.id, change: { target: "project", action: "leave", projectId: "project" } });
  const before = host.store.require(bot.id);
  await host.harness.behavior.callRpc("conversation_assign", { botId: bot.id, threadId: "chat" });
  expect(host.store.require(bot.id)).toEqual(before); expect(host.store.owner("chat")).toBe(bot.id);
});
