import { afterEach, expect, it } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { backend, PERSONAL_ID, request } from "./backend-fixture";

const hosts: Awaited<ReturnType<typeof backend>>[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose(); });

async function setup() {
  const host = await backend(); hosts.push(host);
  const bot = await host.create("Atlas", []);
  const { threadId: main } = await host.harness.behavior.callRpc("conversation_create", { botId: bot.id, request: request(PERSONAL_ID) }) as { threadId: string };
  const getCalls = () => host.harness.inspection.sdk.callsTo("threads.get").map(([args]) => (args as { threadId: string }).threadId);
  return { host, bot, main, getCalls };
}

it("finds a bot's conversations without a threads.get per unbound thread when every ancestor is listed", async () => {
  const { host, bot, main, getCalls } = await setup();
  // Unrelated chats, some with children, and an unbound child that inherits the bot from its listed parent.
  for (let index = 0; index < 40; index++) {
    host.threads.set(`chat-${index}`, makeThreadResponse({ id: `chat-${index}`, projectId: PERSONAL_ID }));
    host.threads.set(`chat-${index}-child`, makeThreadResponse({ id: `chat-${index}-child`, projectId: PERSONAL_ID, parentThreadId: `chat-${index}` }));
  }
  host.threads.set("inherited", makeThreadResponse({ id: "inherited", projectId: PERSONAL_ID, parentThreadId: main }));
  host.harness.inspection.sdk.stub("threads.send", async () => ({ ok: true, delivery: "sent" }) as never);
  const before = getCalls().length;
  const result = await host.harness.behavior.runCli(["message", bot.id, "Status?", "--json"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout!)).toMatchObject({ threadId: main });
  // The only lookup left is `bb bots message` checking its target conversation.
  expect(getCalls().slice(before)).toEqual([main]);
});

it("falls back to a lookup only for an ancestor missing from the listed rows", async () => {
  const { host, bot, main, getCalls } = await setup();
  // An archived, unbound parent is not listed; its child still inherits the bot through it.
  host.threads.set("archived-parent", makeThreadResponse({ id: "archived-parent", projectId: PERSONAL_ID, parentThreadId: main, archivedAt: 1 }));
  host.threads.set("orphan", makeThreadResponse({ id: "orphan", projectId: PERSONAL_ID, parentThreadId: "archived-parent" }));
  for (let index = 0; index < 20; index++) host.threads.set(`chat-${index}`, makeThreadResponse({ id: `chat-${index}`, projectId: PERSONAL_ID }));
  const before = getCalls().length;
  await host.harness.behavior.callRpc("conversation_reorder", { botId: bot.id, threadId: "orphan", targetThreadId: main, position: "before" });
  expect(host.store.require(bot.id).threadOrder).toEqual(["orphan", main]);
  expect(getCalls().slice(before)).toEqual(["archived-parent"]);
});
