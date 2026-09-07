import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { makeMessageDispatchHookContext, makePluginAgentConfigurationContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { backend, request } from "./backend-fixture";

const instances: Awaited<ReturnType<typeof backend>>[] = [];
afterEach(async () => { await Promise.all(instances.splice(0).map(host => host.harness.lifecycle.dispose())); });
async function setup() { const host = await backend(); instances.push(host); return host; }

it("derives the non-conflicting bots-sidebar ID from its package name", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(manifest.name).toBe("bb-plugin-bots-sidebar");
  expect(manifest.name.replace(/^bb-plugin-/, "")).toBe("bots-sidebar");
  expect(manifest.bb.name).toBe("Bots Sidebar");
});

it("attributes new bot conversations to the new plugin ID before their first turn", async () => {
  const host = await setup(); const bot = await host.create("Atlas");
  expect(host.bb.pluginId).toBe("bots-sidebar");
  const result = await host.harness.behavior.callRpc("conversation_create", { botId: bot.id, request: request() }) as { threadId: string };
  expect(host.threads.get(result.threadId)?.originPluginId).toBe("bots-sidebar");
  expect(host.store.owner(result.threadId)).toBe(bot.id);
  expect(host.initialConfigurations.at(-1)?.instructions).toContain("You are Atlas.");
});

it("preserves migrated bindings and inheritance for historical bots-origin threads", async () => {
  const host = await setup(); const owner = await host.create("Owner"); const member = await host.create("Historical bot");
  await host.harness.behavior.callRpc("state_apply", { botId: owner.id, change: { target: "project", action: "own", projectId: "project" } });
  const legacy = makeThreadResponse({ id: "legacy", projectId: "project", originPluginId: "bots", createdAt: Date.now() + 1 });
  host.threads.set(legacy.id, legacy); host.store.bind(legacy.id, member.id);
  await host.harness.inspection.registrations.hooks["message.dispatch"]!(makeMessageDispatchHookContext({ thread: legacy }));
  const child = makeThreadResponse({ id: "child", projectId: "project", parentThreadId: legacy.id, originPluginId: null, createdAt: Date.now() + 1 });
  host.threads.set(child.id, child); await host.harness.behavior.emitThreadEvent("thread.created", { thread: child });
  expect(host.store.owner(legacy.id)).toBe(member.id); expect(host.store.owner(child.id)).toBe(member.id);
  const config = await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: legacy.id }, project: { id: "project" } }));
  expect(config.instructions).toContain("You are Historical bot.");
  expect(config.tools.map(tool => tool.name)).toEqual(["bot_read_state", "bot_update_state"]);
});

it("does not trust another plugin named bots as a new explicit start", async () => {
  const host = await setup(); const owner = await host.create("Owner"); const member = await host.create("Other identity");
  await host.harness.behavior.callRpc("state_apply", { botId: owner.id, change: { target: "project", action: "own", projectId: "project" } });
  const token = "11111111-1111-4111-8111-111111111111"; host.store.stageStart(token, member.id, "project");
  const foreign = makeThreadResponse({ id: "foreign", projectId: "project", originPluginId: "bots", status: "pending", createdAt: Date.now() + 1 }); host.threads.set(foreign.id, foreign);
  await host.harness.inspection.registrations.hooks["message.dispatch"]!(makeMessageDispatchHookContext({ thread: foreign, input: { blocks: [{ type: "text", text: `[bb-bot-start:${token}]`, visibility: "agent-only", mentions: [] }] } }));
  expect(host.store.owner(foreign.id)).toBe(owner.id);
  expect(host.store.pendingStart(token)).toBe(member.id);
});
