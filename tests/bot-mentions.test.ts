import { afterEach, expect, it } from "vitest";
import { BOT_MENTION_LIMIT } from "../lib/bot-mentions";
import { backend } from "./backend-fixture";

const instances: Awaited<ReturnType<typeof backend>>[] = [];
afterEach(async () => { await Promise.all(instances.splice(0).map(host => host.harness.lifecycle.dispose())); });
async function setup() { const host = await backend(); instances.push(host); return host; }
function provider(host: Awaited<ReturnType<typeof backend>>) {
  const value = host.harness.inspection.registrations.mentionProviders.find(provider => provider.id === "bots");
  if (!value) throw new Error("Missing Bots mention provider"); return value;
}
const context = (query: string) => ({ trigger: "@" as const, query, projectId: null, threadId: null });

it("registers bots under the native @ trigger and Bots group", async () => {
  const host = await setup(); const p = provider(host);
  expect(p.label).toBe("Bots"); expect(p.triggers).toEqual(["@"]);
  expect(await p.search({ ...context("a"), trigger: "#" })).toEqual([]);
});

it("matches names, roles and IDs without requiring project membership", async () => {
  const host = await setup(); const bot = await host.create("Atlas", []);
  host.store.mutate(bot.id, current => ({ ...current, role: "Compiler specialist" }));
  const p = provider(host);
  for (const query of ["atl", " ATLAS ", "compiler", bot.id]) {
    const items = await p.search({ ...context(query), projectId: "unlinked-work-project", threadId: "unassigned" });
    expect(items.map(item => item.id)).toEqual([bot.id]); expect(items[0]?.title).toBe("Atlas");
    expect(items[0]?.subtitle).toContain("Compiler specialist"); expect(items[0]?.subtitle).toContain(bot.id);
  }
});

it("supports @bots discovery, includes hidden bots and disambiguates duplicate names", async () => {
  const host = await setup(); const a = await host.create("Atlas", []); const b = await host.create("Atlas", []);
  host.store.mutate(b.id, current => ({ ...current, hiddenUntilActivity: true, hiddenAt: Date.now() }));
  const items = await provider(host).search(context("bots"));
  expect(items.map(item => item.id)).toEqual([a.id, b.id]);
  expect(items[0]?.subtitle).not.toEqual(items[1]?.subtitle);
  expect((await provider(host).search(context("Atlas"))).map(item => item.id)).toEqual([a.id, b.id]);
});

it("ranks exact and prefix name matches before role-only matches", async () => {
  const host = await setup(); const roleOnly = await host.create("Researcher", []); const prefix = await host.create("Atlas tools", []); const exact = await host.create("Atlas", []);
  host.store.mutate(roleOnly.id, current => ({ ...current, role: "Atlas coordinator" }));
  expect((await provider(host).search(context("atlas"))).map(item => item.id)).toEqual([exact.id, prefix.id, roleOnly.id]);
});

it("bounds results but searches past the first page", async () => {
  const host = await setup(); const template = await host.create("Template", []);
  for (let index = 0; index < BOT_MENTION_LIMIT + 10; index++) host.store.save({ ...template, id: `candidate-${index}`, name: `Candidate ${index}`, order: index + 1 });
  expect((await provider(host).search(context(""))).length).toBe(BOT_MENTION_LIMIT);
  expect((await provider(host).search(context("Candidate 39"))).map(item => item.id)).toEqual(["candidate-39"]);
  expect(await provider(host).search(context("a".repeat(300)))).toEqual([]);
});

it("resolves stable IDs using current public metadata, not private state or a stale name", async () => {
  const host = await setup(); const bot = await host.create("Atlas", []);
  host.store.mutate(bot.id, current => ({ ...current, name: "Renamed bot", role: "Reviewer", mainThreadId: "main-thread", soul: "PRIVATE_SOUL_SENTINEL", agents: "PRIVATE_AGENTS_SENTINEL", memory: "PRIVATE_MEMORY_SENTINEL", settings: { secret: "PRIVATE_SETTINGS_SENTINEL" } }));
  const before = host.store.require(bot.id); const sdkCalls = host.harness.inspection.sdk.calls.length;
  const result = await provider(host).resolve(bot.id);
  expect(result.context).toContain('"name":"Renamed bot"'); expect(result.context).toContain('"role":"Reviewer"');
  expect(result.context).toContain(`bb bots message '${bot.id}' '<message>'`);
  expect(result.context).toContain("does not send a message"); expect(result.context).toContain("not your identity");
  expect(result.context).not.toContain("PRIVATE_"); expect(result.context.length).toBeLessThan(1500);
  await provider(host).search(context("renamed"));
  expect(host.store.require(bot.id)).toEqual(before); expect(host.store.bindings()).toEqual([]);
  expect(host.harness.inspection.sdk.calls.length).toBe(sdkCalls);
});

it("keeps bots without a main referenceable without starting a conversation", async () => {
  const host = await setup(); const bot = await host.create("New bot", []);
  const item = (await provider(host).search(context("New bot")))[0]!;
  expect(item.subtitle).toContain("No main conversation yet");
  const result = await provider(host).resolve(item.id); expect(result.context).toContain("no main conversation yet");
  expect(host.harness.inspection.sdk.callsTo("threads.spawn")).toEqual([]);
  expect(host.harness.inspection.sdk.callsTo("threads.send")).toEqual([]);
});

it("rejects a stale/deleted identity rather than silently choosing a namesake", async () => {
  const host = await setup(); const a = await host.create("Atlas", []); const b = await host.create("Atlas", []);
  host.bb.storage.database().prepare("DELETE FROM bots WHERE id=?").run(a.id);
  expect(() => provider(host).resolve(a.id)).toThrow(/no longer exists/);
  expect(provider(host).resolve(b.id)).toBeTruthy();
});
