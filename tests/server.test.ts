import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeMessageDispatchHookContext, makePluginAgentConfigurationContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { BotMetadata } from "../contract";
import { avatar, backend, hash, PERSONAL_ID, request, project } from "./backend-fixture";

const instances: Awaited<ReturnType<typeof backend>>[] = [];
async function setup(projects = [project()]) { const host = await backend(projects); instances.push(host); return host; }
afterEach(async () => { await Promise.all(instances.splice(0).map((host) => host.harness.lifecycle.dispose())); });
const editable = (bot: BotMetadata) => ({ botId: bot.id, name: bot.name, role: bot.role, avatar: bot.avatar, sectionId: bot.sectionId, linkedProjectIds: bot.linkedProjectIds, soul: bot.soul, expectedUpdatedAt: bot.updatedAt, expectedStateHashes: bot.stateHashes });
const asJSON = (value: unknown) => JSON.parse(value as string);

function legacyRecord() {
  return { id: "bot_legacy", name: "Legacy bot", role: "Research", avatar, hostId: "host-project", homePath: "/legacy/bot-home", homeProjectId: "old-home", linkedProjectIds: ["project"], mainThreadId: "old-main", hiddenUntilActivity: false, hiddenAt: null, sectionId: null, order: 0, soul: "Cached identity", agents: "Cached rules", memory: "Cached memory", settings: { cached: true }, stateHashes: { "SOUL.md": hash("Cached identity"), "AGENTS.md": hash("Cached rules"), "MEMORY.md": hash("Cached memory"), "settings.json": hash('{"cached":true}') }, updatedAt: 1, legacyProjectId: "project" };
}

describe("private bot identities", () => {
  it("creates private ID-keyed state without projects or execution-host filesystem writes", async () => {
    const host = await setup(); const bot = await host.create("Atlas", []);
    expect(bot.stateReady).toBe(true);
    expect(bot.legacyHomeProjectId).toBeNull();
    expect(bot).not.toHaveProperty("homePath");
    expect(bot).not.toHaveProperty("homeProjectId");
    expect(bot.linkedProjectIds).toEqual([]);
    const directory = host.stateDirectory(bot.id);
    expect(await readFile(join(directory, "SOUL.md"), "utf8")).toBe("You are Atlas.");
    await expect(readFile(join(directory, "AGENTS.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(directory, "MEMORY.md"), "utf8")).toBe("");
    expect(JSON.parse(await readFile(join(directory, "settings.json"), "utf8"))).toEqual({});
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, "SOUL.md"))).mode & 0o777).toBe(0o600);
    for (const method of ["projects.create", "projects.update", "files.write", "files.mkdir", "hosts.directory"]) expect(host.harness.inspection.sdk.callsTo(method)).toHaveLength(0);
    const list = await host.harness.behavior.callRpc("bots_list", null) as { projects: { id: string }[]; personalProjectId: string };
    expect(list.projects.map((p) => p.id)).toEqual(["project"]);
    expect(list.personalProjectId).toBe(PERSONAL_ID);
  });

  it.each([PERSONAL_ID, "project"])("keeps two bots separate in %s and binds before first-turn instructions", async (projectId) => {
    const host = await setup(); const first = await host.create("Atlas"); const second = await host.create("Nova");
    const input = request(projectId);
    const a = await host.harness.behavior.callRpc("conversation_create", { botId: first.id, request: input }) as { threadId: string };
    const b = await host.harness.behavior.callRpc("conversation_create", { botId: second.id, request: input }) as { threadId: string };
    expect(host.initialConfigurations[0]?.instructions).toContain("You are Atlas.");
    expect(host.initialConfigurations[0]?.instructions).not.toContain("You are Nova.");
    expect(host.initialConfigurations[1]?.instructions).toContain("You are Nova.");
    expect(host.initialConfigurations[0]?.instructions).not.toContain(host.stateDirectory(first.id));
    expect(host.initialConfigurations[0]?.tools).toEqual(["bot_read_state", "bot_update_state"]);
    const bindings = (await host.harness.behavior.callRpc("bots_list", null) as { threadBindings: unknown[] }).threadBindings;
    expect(bindings).toEqual(expect.arrayContaining([{ threadId: a.threadId, botId: first.id }, { threadId: b.threadId, botId: second.id }]));
    const submitted = host.harness.inspection.sdk.callsTo("threads.spawn")[0]![0] as { input: unknown[]; environment: unknown; executionInputSources: unknown };
    expect(submitted.input.slice(0, input.input.length)).toEqual(input.input);
    expect(submitted.executionInputSources).toEqual(input.executionInputSources);
    expect(submitted.environment).toEqual(input.environment);
    expect(submitted.input.at(-1)).toMatchObject({ type: "text", visibility: "agent-only" });
    const unrelated = await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: "unrelated" }, project: { id: projectId } }));
    expect(unrelated.instructions).toBeNull(); expect(unrelated.tools).toEqual([]);
    expect(host.harness.inspection.sdk.callsTo("projects.create")).toEqual([]);
  });

  it("accepts BB 0.43 provider-supplied environments (personal-workspace / project-checkout)", async () => {
    // BB 0.43 routes personal-workspace and project-checkout environments
    // through registered environment providers, so the composer submits a
    // `provider` environment instead of the legacy `host`/`personal` shape.
    // Rejecting it at the RPC boundary broke every bot conversation_create
    // with "rpc input validation failed".
    const host = await setup(); const bot = await host.create();
    const providerRequest: ReturnType<typeof request> = {
      ...request(PERSONAL_ID),
      environment: { type: "provider", environmentProviderId: "environment-personal-workspace", machine: { type: "existing", hostId: "host-home" }, inputs: null },
    };
    const created = await host.harness.behavior.callRpc("conversation_create", { botId: bot.id, request: providerRequest }) as { threadId: string };
    expect(created.threadId).toBeTruthy();
    const submitted = host.harness.inspection.sdk.callsTo("threads.spawn")[0]![0] as { environment: unknown };
    expect(submitted.environment).toEqual(providerRequest.environment);
  });

  it("preserves schedules and ownership across reload", async () => {
    const host = await setup(); const bot = await host.create(); const when = Date.now() + 86_400_000;
    const created = await host.harness.behavior.callRpc("conversation_create", { botId: bot.id, request: { ...request(PERSONAL_ID), sendAt: when }, makeMain: true }) as { threadId: string };
    expect(host.initialConfigurations).toEqual([]);
    expect(host.harness.inspection.sdk.callsTo("threads.spawn")[0]?.[0]).toMatchObject({ sendAt: when, projectId: PERSONAL_ID });
    await host.reload();
    const config = await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: created.threadId }, project: { id: PERSONAL_ID } }));
    expect(config.instructions).toContain("You are Atlas.");
    expect(host.store.require(bot.id).mainThreadId).toBe(created.threadId);
  });

  it("recovers first-turn ownership after a lost spawn response and reload", async () => {
    const host = await setup(); const bot = await host.create();
    const pending = makeThreadResponse({ id: "pending", projectId: PERSONAL_ID, originPluginId: host.bb.pluginId });
    host.harness.inspection.sdk.stub("threads.spawn", async () => { host.threads.set(pending.id, pending); throw new Error("Connection lost after creation"); });
    await expect(host.harness.behavior.callRpc("conversation_create", { botId: bot.id, request: request(PERSONAL_ID) })).rejects.toThrow(/Connection lost/);
    const sent = host.harness.inspection.sdk.callsTo("threads.spawn")[0]![0] as { input: ReturnType<typeof request>["input"] };
    await host.reload();
    await host.harness.inspection.registrations.hooks["message.dispatch"]!(makeMessageDispatchHookContext({ thread: pending, input: { blocks: sent.input } }));
    const config = await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: pending.id }, project: { id: PERSONAL_ID } }));
    expect(config.instructions).toContain("You are Atlas.");
  });

  it("inherits ownership into children and forks without project-based inference", async () => {
    const host = await setup(); const bot = await host.create();
    const created = await host.harness.behavior.callRpc("conversation_create", { botId: bot.id, request: request(PERSONAL_ID) }) as { threadId: string };
    const child = makeThreadResponse({ id: "child", parentThreadId: created.threadId, projectId: "other-project" }); host.threads.set(child.id, child);
    await host.harness.behavior.emitThreadEvent("thread.created", { thread: child });
    const config = await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: child.id, parentThreadId: created.threadId }, project: { id: "other-project" } }));
    expect(config.instructions).toContain("You are Atlas.");
    const fork = await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: "fork", sourceThreadId: child.id }, project: { id: "project" } }));
    expect(fork.instructions).toContain("You are Atlas.");
  });

  it("joins explicitly selected work projects but rejects missing projects and stealing conversations", async () => {
    const host = await setup([project(), project("other")]); const a = await host.create("Atlas"); const b = await host.create("Nova");
    await host.harness.behavior.callRpc("conversation_create", { botId: a.id, request: request("other") });
    expect(host.store.require(a.id).linkedProjectIds).toContain("other");
    await expect(host.harness.behavior.callRpc("conversation_create", { botId: a.id, request: request("missing") })).rejects.toThrow(/existing work project/);
    const created = await host.harness.behavior.callRpc("conversation_create", { botId: a.id, request: request(PERSONAL_ID) }) as { threadId: string };
    await expect(host.harness.behavior.callRpc("conversation_assign", { botId: b.id, threadId: created.threadId })).rejects.toThrow(/another bot/);
    await expect(host.harness.behavior.callRpc("main_set", { botId: b.id, threadId: created.threadId })).rejects.toThrow(/does not belong/);
  });
});

describe("private state data", () => {
  it("reads/writes state while the execution machine is offline and exposes no storage paths", async () => {
    const host = await setup(); const bot = await host.create();
    const created = await host.harness.behavior.callRpc("conversation_create", { botId: bot.id, request: request() }) as { threadId: string };
    host.offline.add("host-home"); const ctx = { threadId: created.threadId, projectId: "project" };
    const before = asJSON(await host.harness.behavior.callAgentTool("bot_read_state", { target: "memory" }, ctx));
    expect(before.state.sha256).toBe(hash("")); expect(before.state).not.toHaveProperty("path");
    const result = asJSON(await host.harness.behavior.callAgentTool("bot_update_state", { target: "memory", action: "append", fact: "Prefer focused changes." }, ctx));
    expect(result.state.sha256).toBe(hash("- Prefer focused changes.\n"));
    expect(result.state).not.toHaveProperty("path");
    expect(await readFile(join(host.stateDirectory(bot.id), "MEMORY.md"), "utf8")).toBe("- Prefer focused changes.\n");
    expect(host.harness.inspection.sdk.callsTo("files.write")).toEqual([]);
    expect(host.harness.inspection.sdk.callsTo("hosts.directory")).toEqual([]);
    const identity = asJSON(await host.harness.behavior.callAgentTool("bot_read_state", { target: "identity" }, ctx));
    expect(identity.state).not.toHaveProperty("homePath"); expect(identity.state).not.toHaveProperty("hostId");
  });

  it("rejects stale expected hashes without changing canonical state", async () => {
    const host = await setup(); const bot = await host.create();
    const before = await host.harness.behavior.callRpc("state_read", { botId: bot.id, file: "MEMORY.md" }) as { sha256: string };
    await host.harness.behavior.callRpc("state_update", { botId: bot.id, file: "MEMORY.md", content: "New state", expectedSha256: before.sha256 });
    await expect(host.harness.behavior.callRpc("state_update", { botId: bot.id, file: "MEMORY.md", content: "Stale state", expectedSha256: before.sha256 })).rejects.toThrow(/changed/);
    expect(host.store.require(bot.id).memory).toBe("New state");
  });

  it("saves identity atomically and rejects incorrect hashes before changing any fields", async () => {
    const host = await setup(); const bot = await host.create();
    await expect(host.harness.behavior.callRpc("bot_update", { ...editable(bot), name: "New name", soul: "New soul", expectedStateHashes: { ...bot.stateHashes, "SOUL.md": "0".repeat(64) } })).rejects.toThrow(/changed/);
    expect(host.store.require(bot.id)).toMatchObject({ name: "Atlas", soul: "You are Atlas.", updatedAt: bot.updatedAt });
    const updated = await host.harness.behavior.callRpc("bot_update", { ...editable(bot), name: "New name", soul: "New soul" }) as BotMetadata;
    expect(updated).toMatchObject({ name: "New name", soul: "New soul" });
    expect(host.harness.inspection.sdk.callsTo("projects.update")).toEqual([]);
    await expect(host.harness.behavior.callRpc("bot_update", editable(bot))).rejects.toThrow(/changed while editing/);
  });

  it("can create a bot while its execution host is offline", async () => {
    const host = await setup(); host.offline.add("host-home");
    const bot = await host.create("Offline-ready", []);
    expect(bot.stateReady).toBe(true);
    expect(host.harness.inspection.sdk.callsTo("projects.create")).toEqual([]);
    expect(host.harness.inspection.sdk.callsTo("files.mkdir")).toEqual([]);
  });

  it("rejects filesystem path arguments and invalid JSON/state file names", async () => {
    const host = await setup(); const bot = await host.create();
    const settings = await host.harness.behavior.callRpc("state_read", { botId: bot.id, file: "settings.json" }) as { sha256: string };
    await expect(host.harness.behavior.callRpc("state_update", { botId: bot.id, file: "settings.json", content: "[]", expectedSha256: settings.sha256 })).rejects.toThrow();
    await expect(host.harness.behavior.callRpc("state_read", { botId: bot.id, file: "../SOUL.md" })).rejects.toThrow();
    await expect(host.harness.behavior.callRpc("bot_create", { name: "Invalid", role: "", hostId: "host-home", avatar, sectionId: null, linkedProjectIds: [], soul: "", homePath: "/projects/project" })).rejects.toThrow();
  });

  it("defaults create memory/settings and accepts initial private state", async () => {
    const host = await setup();
    const omitted = await host.create("Defaults", []);
    expect(omitted).toMatchObject({ memory: "", settings: {} });
    expect(await readFile(join(host.stateDirectory(omitted.id), "MEMORY.md"), "utf8")).toBe("");
    expect(JSON.parse(await readFile(join(host.stateDirectory(omitted.id), "settings.json"), "utf8"))).toEqual({});
    const created = await host.harness.behavior.callRpc("bot_create", {
      name: "Seeded", role: "Research", hostId: "host-home", avatar, sectionId: null, linkedProjectIds: [],
      soul: "You are Seeded.", memory: "- Remember the user.\n", settings: { tone: "concise" },
    }) as BotMetadata;
    expect(created).toMatchObject({ memory: "- Remember the user.\n", settings: { tone: "concise" } });
    expect(await readFile(join(host.stateDirectory(created.id), "MEMORY.md"), "utf8")).toBe("- Remember the user.\n");
    expect(JSON.parse(await readFile(join(host.stateDirectory(created.id), "settings.json"), "utf8"))).toEqual({ tone: "concise" });
    expect(created.stateHashes["MEMORY.md"]).toBe(hash("- Remember the user.\n"));
    expect(host.harness.inspection.sdk.callsTo("files.write")).toEqual([]);
  });

  it("saves identity and private state atomically across all three active files", async () => {
    const host = await setup(); const bot = await host.create();
    const updated = await host.harness.behavior.callRpc("bot_update", {
      ...editable(bot), name: "Orion", soul: "New soul",
      memory: "- Keep facts short.\n", settings: { timezone: "UTC" },
    }) as BotMetadata;
    expect(updated).toMatchObject({ name: "Orion", soul: "New soul", memory: "- Keep facts short.\n", settings: { timezone: "UTC" } });
    const directory = host.stateDirectory(bot.id);
    expect(await readFile(join(directory, "SOUL.md"), "utf8")).toBe("New soul");
    await expect(readFile(join(directory, "AGENTS.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(directory, "MEMORY.md"), "utf8")).toBe("- Keep facts short.\n");
    expect(JSON.parse(await readFile(join(directory, "settings.json"), "utf8"))).toEqual({ timezone: "UTC" });
    expect(updated.stateHashes).toMatchObject({
      "SOUL.md": hash("New soul"), "AGENTS.md": null,
      "MEMORY.md": hash("- Keep facts short.\n"), "settings.json": hash(`${JSON.stringify({ timezone: "UTC" }, null, 2)}\n`),
    });
  });

  it("rejects stale memory/settings hashes without a partial save or export", async () => {
    const host = await setup(); const bot = await host.create();
    const before = host.store.require(bot.id);
    const stale = { ...bot.stateHashes, "MEMORY.md": "0".repeat(64) };
    await expect(host.harness.behavior.callRpc("bot_update", {
      ...editable(bot), name: "Must not save", soul: "Must not save",
      memory: "- Stale memory.\n", settings: { stale: true }, expectedStateHashes: stale,
    })).rejects.toThrow(/changed/);
    expect(host.store.require(bot.id)).toMatchObject({ name: "Atlas", soul: "You are Atlas.", memory: "", settings: {}, updatedAt: before.updatedAt });
    expect(await readFile(join(host.stateDirectory(bot.id), "MEMORY.md"), "utf8")).toBe("");
    expect(JSON.parse(await readFile(join(host.stateDirectory(bot.id), "settings.json"), "utf8"))).toEqual({});
    await expect(host.harness.behavior.callRpc("bot_update", {
      ...editable(bot), memory: "- Fresh memory.\n", settings: { ok: true }, expectedStateHashes: { ...bot.stateHashes, "settings.json": "0".repeat(64) },
    })).rejects.toThrow(/changed/);
    expect(host.store.require(bot.id).memory).toBe("");
    expect(host.store.require(bot.id).settings).toEqual({});
  });

  it("preserves omitted memory/settings on bot_update and identity/set", async () => {
    const host = await setup(); const bot = await host.create();
    const seeded = await host.harness.behavior.callRpc("bot_update", {
      ...editable(bot), memory: "- Keep me.\n", settings: { keep: true },
    }) as BotMetadata;
    const renamed = await host.harness.behavior.callRpc("bot_update", { ...editable(seeded), name: "Renamed" }) as BotMetadata;
    expect(renamed).toMatchObject({ name: "Renamed", memory: "- Keep me.\n", settings: { keep: true } });
    const staleOmitted = await host.harness.behavior.callRpc("bot_update", {
      ...editable(renamed), role: "Archivist", expectedStateHashes: { ...renamed.stateHashes, "MEMORY.md": "0".repeat(64), "settings.json": "0".repeat(64) },
    }) as BotMetadata;
    expect(staleOmitted).toMatchObject({ role: "Archivist", memory: "- Keep me.\n", settings: { keep: true } });
    const created = await host.harness.behavior.callRpc("conversation_create", { botId: bot.id, request: request() }) as { threadId: string };
    const ctx = { threadId: created.threadId, projectId: "project" };
    const identity = asJSON(await host.harness.behavior.callAgentTool("bot_read_state", { target: "identity" }, ctx));
    const result = asJSON(await host.harness.behavior.callAgentTool("bot_update_state", { target: "identity", action: "set", expectedRevision: identity.revision, name: "Native" }, ctx));
    expect(result.state.name).toBe("Native");
    expect(host.store.require(bot.id)).toMatchObject({ name: "Native", memory: "- Keep me.\n", settings: { keep: true } });
  });

  it("rejects oversized or invalid memory/settings without changing existing files", async () => {
    const host = await setup(); const bot = await host.create();
    const oversizedMemory = "x".repeat(16385);
    const oversizedSettings = { note: "x".repeat(16384) };
    await expect(host.harness.behavior.callRpc("bot_create", {
      name: "Too big", role: "", hostId: "host-home", avatar, sectionId: null, linkedProjectIds: [], soul: "", memory: oversizedMemory,
    })).rejects.toThrow();
    await expect(host.harness.behavior.callRpc("bot_create", {
      name: "Too big", role: "", hostId: "host-home", avatar, sectionId: null, linkedProjectIds: [], soul: "", settings: oversizedSettings,
    })).rejects.toThrow();
    await expect(host.harness.behavior.callRpc("bot_create", {
      name: "Invalid", role: "", hostId: "host-home", avatar, sectionId: null, linkedProjectIds: [], soul: "", settings: [],
    })).rejects.toThrow();
    await expect(host.harness.behavior.callRpc("bot_update", { ...editable(bot), memory: oversizedMemory })).rejects.toThrow();
    await expect(host.harness.behavior.callRpc("bot_update", { ...editable(bot), settings: oversizedSettings })).rejects.toThrow();
    await expect(host.harness.behavior.callRpc("bot_update", { ...editable(bot), settings: [] })).rejects.toThrow();
    expect(host.store.require(bot.id)).toMatchObject({ memory: "", settings: {}, updatedAt: bot.updatedAt });
    expect(await readFile(join(host.stateDirectory(bot.id), "MEMORY.md"), "utf8")).toBe("");
  });
});

describe("v2 state import", () => {
  it("imports old home files once, preserving main/history and never re-importing stale state", async () => {
    const host = await setup([project(), project("old-home", "host-project", "/legacy/bot-home")]); const old = legacyRecord();
    host.seedLegacy(old); host.store.bind("old-main", old.id);
    host.put(old.hostId, `${old.homePath}/bot.json`, JSON.stringify({ version: 2, id: old.id }));
    host.put(old.hostId, `${old.homePath}/SOUL.md`, "Latest legacy identity"); host.put(old.hostId, `${old.homePath}/AGENTS.md`, "Latest rules");
    host.put(old.hostId, `${old.homePath}/MEMORY.md`, "- Stable fact.\n"); host.put(old.hostId, `${old.homePath}/settings.json`, '{"preference":true}');
    const list = await host.harness.behavior.callRpc("bots_list", null) as { bots: BotMetadata[]; projects: { id: string }[]; warnings: string[] };
    expect(list.bots[0]).toMatchObject({ id: old.id, stateReady: true, soul: "Latest legacy identity", memory: "- Stable fact.\n", settings: { preference: true }, legacyHomeProjectId: "old-home", mainThreadId: "old-main" });
    expect(list.projects.map((project) => project.id)).toEqual(["project"]);
    expect(list.warnings).toEqual([]);
    expect(host.store.owner("old-main")).toBe(old.id);
    host.put(old.hostId, `${old.homePath}/MEMORY.md`, "Stale source changed later");
    await host.reload(); await host.harness.behavior.callRpc("bots_list", null);
    expect(host.store.require(old.id).memory).toBe("- Stable fact.\n");
    expect(host.harness.inspection.sdk.callsTo("files.write")).toEqual([]);
    expect(host.harness.inspection.sdk.callsTo("projects.create")).toEqual([]);
    const unknown = await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: "unassigned-legacy-home" }, project: { id: "old-home" } }));
    expect(unknown.tools).toEqual([]);
  });

  it("uses its own cache if the legacy machine is offline, without later replacing newer state", async () => {
    const host = await setup(); const old = legacyRecord(); host.seedLegacy(old); host.offline.add(old.hostId);
    const bot = await host.harness.behavior.callRpc("bot_prepare", { botId: old.id }) as BotMetadata;
    expect(bot.stateReady).toBe(true); expect(bot.soul).toBe("Cached identity");
    await host.harness.behavior.callRpc("state_update", { botId: old.id, file: "MEMORY.md", content: "New private state", expectedSha256: bot.stateHashes["MEMORY.md"] });
    host.offline.delete(old.hostId); host.put(old.hostId, `${old.homePath}/MEMORY.md`, "Old remote state");
    await host.harness.behavior.callRpc("bot_prepare", { botId: old.id });
    expect(host.store.require(old.id).memory).toBe("New private state");
  });
});

it("injects fixed guidance, SOUL and all compliant memory, without archived bot AGENTS", async () => {
  const host = await setup(); const bot = await host.create();
  host.store.save({ ...bot, name: "N".repeat(120), role: "R".repeat(80), soul: "Unique soul " + "s".repeat(4084), agents: "Archived instructions must not run", memory: "m".repeat(3000) });
  host.store.bind("configured", bot.id);
  const configuration = await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: "configured" } }));
  expect(configuration.instructions).toContain("Unique soul");
  expect(configuration.instructions).toContain("m".repeat(3000));
  expect(configuration.instructions!.length).toBeLessThanOrEqual(4096);
  expect(configuration.instructions).toContain("[Truncated: use bot_read_state for complete state.]");
  const guidance = host.harness.inspection.registrations.agentTools.find(tool => tool.name === "bot_read_state")!.instructions!;
  expect(guidance).toContain('"action":"overwrite"');
  expect(configuration.instructions).not.toContain("Archived instructions must not run");
  expect(configuration.instructions).not.toContain("## Bot operating instructions");
  expect(guidance).toContain("Current workspace/project AGENTS.md still applies");
  const before = host.store.require(bot.id);
  for (const method of ["state_read", "state_update"]) await expect(host.harness.behavior.callRpc(method, { botId: bot.id, file: "AGENTS.md", ...(method === "state_update" ? { content: "changed", expectedSha256: hash("") } : {}) })).rejects.toThrow();
  expect(host.store.require(bot.id)).toEqual(before);
});

it("rejects memory above 3000 through editor and raw-state RPCs without partial writes", async () => {
  const host = await setup(); const bot = await host.create();
  await expect(host.harness.behavior.callRpc("bot_create", { name: "Too long", role: "", avatar, hostId: "host-home", sectionId: null, soul: "", linkedProjectIds: [], memory: "x".repeat(3001) })).rejects.toThrow();
  await expect(host.harness.behavior.callRpc("bot_update", { ...editable(bot), name: "Must not save", memory: "x".repeat(3001) })).rejects.toThrow();
  await expect(host.harness.behavior.callRpc("state_update", { botId: bot.id, file: "MEMORY.md", content: "x".repeat(3001), expectedSha256: hash("") })).rejects.toThrow();
  expect(host.store.require(bot.id)).toEqual(bot);
  expect(host.store.list()).toHaveLength(1);
});
