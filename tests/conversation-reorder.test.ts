import { afterEach, expect, it } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { backend } from "./backend-fixture";
import { listBotConversations } from "../lib/bot-conversations";

const instances: Awaited<ReturnType<typeof backend>>[] = [];
afterEach(async () => { await Promise.all(instances.splice(0).map(host => host.harness.lifecycle.dispose())); });
async function setup() {
  const host = await backend(); instances.push(host);
  const bot = await host.create(); const other = await host.create("Other");
  for (const [id, parentThreadId, createdAt] of [["a", null, 30], ["b", null, 20], ["c", null, 10], ["child", "a", 40], ["child2", "a", 50], ["foreign", null, 60]] as const) {
    host.threads.set(id, makeThreadResponse({ id, parentThreadId, createdAt }));
    host.store.bind(id, id === "foreign" ? other.id : bot.id);
  }
  host.store.mutate(bot.id, current => ({ ...current, mainThreadId: "a" }));
  return { host, bot };
}

it("persists sibling ordering across reload without changing main pointers, history, bindings, or environments", async () => {
  const { host, bot } = await setup(); const before = [...host.threads.values()]; const bindings = host.store.bindings();
  await host.harness.behavior.callRpc("conversation_reorder", { botId: bot.id, threadId: "c", targetThreadId: "a", position: "before" });
  await host.reload();
  const result = await listBotConversations(host.bb, host.store.require(bot.id), async id => host.store.owner(id));
  expect(result.roots.map(row => row.id)).toEqual(["c", "a", "b"]);
  expect(host.store.require(bot.id).mainThreadId).toBe("a"); expect(host.store.bindings()).toEqual(bindings); expect([...host.threads.values()]).toEqual(before);
  expect(host.harness.inspection.sdk.callsTo("threads.update")).toEqual([]);
});

it("reorders children without moving their parent", async () => {
  const { host, bot } = await setup();
  await host.harness.behavior.callRpc("conversation_reorder", { botId: bot.id, threadId: "child2", targetThreadId: "child", position: "after" });
  const order = host.store.require(bot.id).threadOrder!;
  expect(order.indexOf("child2")).toBeGreaterThan(order.indexOf("child"));
  expect(host.threads.get("child2")?.parentThreadId).toBe("a");
});

it.each(["foreign", "child", "missing", "archived", "deleted"])("rejects invalid reorder target %s without changing order", async targetThreadId => {
  const { host, bot } = await setup();
  if (targetThreadId === "archived" || targetThreadId === "deleted") {
    host.threads.set(targetThreadId, makeThreadResponse({ id: targetThreadId, ...(targetThreadId === "archived" ? { archivedAt: 1 } : { deletedAt: 1 }) })); host.store.bind(targetThreadId, bot.id);
  }
  await expect(host.harness.behavior.callRpc("conversation_reorder", { botId: bot.id, threadId: "b", targetThreadId, position: "before" })).rejects.toThrow();
  expect(host.store.require(bot.id).threadOrder).toBeUndefined();
});

it("serializes simultaneous moves against current order and skips archived first rows", async () => {
  const { host, bot } = await setup();
  await Promise.all([
    host.harness.behavior.callRpc("conversation_reorder", { botId: bot.id, threadId: "c", targetThreadId: "a", position: "before" }),
    host.harness.behavior.callRpc("conversation_reorder", { botId: bot.id, threadId: "b", targetThreadId: "c", position: "before" }),
  ]);
  host.threads.set("b", { ...host.threads.get("b")!, archivedAt: 1 });
  expect((await listBotConversations(host.bb, host.store.require(bot.id), async id => host.store.owner(id))).roots.map(row => row.id)).toEqual(["c", "a"]);
});
