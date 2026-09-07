import { afterEach, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { BotMetadata } from "../contract";
import { avatar, backend, project } from "./backend-fixture";

const instances: Awaited<ReturnType<typeof backend>>[] = [];
async function setup(projects = [project()]) { const host = await backend(projects); instances.push(host); return host; }
afterEach(async () => { await Promise.all(instances.splice(0).map((host) => host.harness.lifecycle.dispose())); });
const legacy = (overrides = {}) => JSON.stringify({ version: 1, role: "Chief of staff", avatar, hiddenUntilActivity: false, hiddenAt: null, mainThreadId: "old-main", awaitingMain: false, sectionId: "old-section", order: 3, updatedAt: 1, ...overrides });

it("does not turn ordinary or newly-added projects into bots", async () => {
  const host = await setup();
  const first = await host.harness.behavior.callRpc("bots_list", null) as { bots: BotMetadata[] };
  expect(first.bots).toEqual([]);
  host.projects.push(project("new-project"));
  host.put("host-project", "/projects/new-project/bot.json", legacy());
  expect((await host.harness.behavior.callRpc("bots_list", null) as { bots: BotMetadata[] }).bots).toEqual([]);
  expect(host.harness.inspection.sdk.callsTo("files.write")).toEqual([]);
  expect(host.harness.inspection.sdk.callsTo("projects.create")).toEqual([]);
});

it("migrates existing bot identities and all history once without touching project files or workspaces", async () => {
  const host = await setup();
  const config = legacy();
  host.put("host-project", "/projects/project/bot.json", config);
  host.put("host-project", "/projects/project/SOUL.md", "Legacy personality");
  host.put("host-project", "/projects/project/AGENTS.md", "Repository-only instructions");
  await host.bb.storage.kv.set("project-bot-sections-v1", [{ id: "old-section", name: "Work", order: 0 }]);
  for (let index = 0; index < 205; index++) host.threads.set(`old-${index}`, makeThreadResponse({ id: `old-${index}`, projectId: "project", createdAt: 1 }));
  host.threads.set("old-main", makeThreadResponse({ id: "old-main", projectId: "project", createdAt: 1 }));
  host.threads.set("archived", makeThreadResponse({ id: "archived", projectId: "project", createdAt: 1, archivedAt: 2 }));
  const list = await host.harness.behavior.callRpc("bots_list", null) as { bots: BotMetadata[]; threadBindings: { botId: string; threadId: string }[]; warnings: string[] };
  expect(list.warnings).toEqual([]);
  expect(list.bots).toHaveLength(1);
  const bot = list.bots[0]!;
  expect(bot.name).toBe("Project project");
  expect(bot.legacyProjectId).toBe("project");
  expect(bot.linkedProjectIds).toEqual(["project"]);
  expect(bot.mainThreadId).toBe("old-main");
  expect(bot.legacyHomeProjectId).toBeNull();
  expect(bot.stateReady).toBe(true);
  expect(bot).not.toHaveProperty("homePath");
  expect(bot.soul).toBe("Legacy personality");
  expect(bot.agents).not.toContain("Repository-only instructions");
  expect(list.threadBindings).toHaveLength(207);
  expect(list.threadBindings.every((binding) => binding.botId === bot.id)).toBe(true);
  expect(host.get("host-project", "/projects/project/bot.json")).toBe(config);
  expect(host.get("host-project", "/projects/project/AGENTS.md")).toBe("Repository-only instructions");
  expect(host.harness.inspection.sdk.callsTo("files.write")).toEqual([]);
  expect(host.harness.inspection.sdk.callsTo("projects.update")).toEqual([]);
  expect(host.harness.inspection.sdk.callsTo("projects.create")).toEqual([]);
  host.threads.set("later", makeThreadResponse({ id: "later", projectId: "project", createdAt: Date.now() }));
  await host.reload();
  const again = await host.harness.behavior.callRpc("bots_list", null) as typeof list;
  expect(again.bots[0]?.id).toBe(bot.id);
  expect(again.threadBindings).toHaveLength(207);
  expect(again.threadBindings.some((binding) => binding.threadId === "later")).toBe(false);
  const ready = await host.harness.behavior.callRpc("bot_prepare", { botId: bot.id }) as BotMetadata;
  expect(ready.stateReady).toBe(true);
  expect(host.get("host-project", "/projects/project/SOUL.md")).toBe("Legacy personality");
  expect(await readFile(join(host.stateDirectory(ready.id), "SOUL.md"), "utf8")).toBe("Legacy personality");
});

it("reconciles offset pages when concurrent archival shifts live history", async () => {
  const host = await setup();
  host.put("host-project", "/projects/project/bot.json", legacy({ sectionId: null }));
  for (let index = 0; index < 205; index++) host.threads.set(`old-${index}`, makeThreadResponse({ id: `old-${index}`, projectId: "project", createdAt: 1 }));
  let moved = false;
  host.harness.inspection.sdk.stub("threads.list", async (raw: unknown) => {
    const { archived, offset, limit } = raw as { archived: boolean; offset: number; limit: number };
    const page = [...host.threads.values()].filter((thread) => Boolean(thread.archivedAt) === archived).slice(offset, offset + limit);
    if (!moved && !archived && offset === 0) {
      moved = true;
      host.threads.set("old-0", { ...host.threads.get("old-0")!, archivedAt: Date.now() });
    }
    return page;
  });
  const result = await host.harness.behavior.callRpc("bots_list", null) as { threadBindings: { threadId: string }[]; warnings: string[] };
  expect(result.warnings).toEqual([]);
  expect(new Set(result.threadBindings.map((binding) => binding.threadId))).toEqual(new Set(host.threads.keys()));
});

it("retries offline migration without marking it complete or overwriting missing state", async () => {
  const host = await setup();
  host.put("host-project", "/projects/project/bot.json", legacy({ sectionId: null }));
  host.put("host-project", "/projects/project/SOUL.md", "Important identity");
  host.offline.add("host-project");
  const first = await host.harness.behavior.callRpc("bots_list", null) as { bots: BotMetadata[]; warnings: string[] };
  expect(first.bots).toEqual([]);
  expect(first.warnings.join(" ")).toContain("Host offline");
  host.offline.delete("host-project");
  const second = await host.harness.behavior.callRpc("bots_list", null) as typeof first;
  expect(second.bots[0]?.soul).toBe("Important identity");
  expect(second.warnings).toEqual([]);
});

it("reports corrupt legacy metadata rather than replacing it with defaults", async () => {
  const host = await setup();
  host.put("host-project", "/projects/project/bot.json", "{broken");
  const list = await host.harness.behavior.callRpc("bots_list", null) as { bots: BotMetadata[]; warnings: string[] };
  expect(list.bots).toEqual([]);
  expect(list.warnings).toHaveLength(1);
  expect(host.get("host-project", "/projects/project/bot.json")).toBe("{broken");
  expect(host.harness.inspection.sdk.callsTo("files.write")).toEqual([]);
});
