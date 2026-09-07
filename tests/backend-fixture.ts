import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { BbPluginApi, NewThreadRequest } from "@get-bb/plugin-sdk";
import { createFakePluginHost, makeMessageDispatchHookContext, makePluginAgentConfigurationContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { createBotStore } from "../lib/bot-store";
import type { BotMetadata } from "../contract";

type Project = Awaited<ReturnType<BbPluginApi["sdk"]["projects"]["get"]>>;
export const PERSONAL_ID = "personal";
export const avatar = { color: "#168b75", shape: "round", expression: "curious", motion: "still" } as const;
export const hash = (content: string) => createHash("sha256").update(content).digest("hex");
export function project(id = "project", hostId = "host-project", path = `/projects/${id}`): Project {
  return { id, name: `Project ${id}`, kind: "standard", gitRemoteUrl: null, createdAt: 1, updatedAt: 1, sources: [{ id: `source-${id}`, projectId: id, hostId, path, type: "local_path", isDefault: true, createdAt: 1, updatedAt: 1 }] };
}
export function request(projectId = "project"): NewThreadRequest {
  return { projectId, providerId: "pi", model: "test", reasoningLevel: "high", permissionMode: "accept-edits", executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" }, environment: projectId === PERSONAL_ID ? { type: "host", hostId: "host-home", workspace: { type: "personal" } } : { type: "project-default" }, input: [{ type: "text", text: "Review @Main", mentions: [{ start: 7, end: 12, resource: { kind: "thread", label: "Main", threadId: "main" } }] }, { type: "localFile", path: "attachments/spec.md", name: "spec.md" }] };
}

export async function backend(initialProjects: Project[] = [project()]) {
  const projects = [...initialProjects];
  const personal = { ...project(PERSONAL_ID), kind: "personal" as const, sources: [] };
  const threads = new Map<string, ReturnType<typeof makeThreadResponse>>();
  const files = new Map<string, string>();
  const offline = new Set<string>();
  const initialConfigurations: { threadId: string; instructions: string | null; tools: string[] }[] = [];
  const key = (hostId: string | undefined, path: string) => `${hostId}:${path}`;
  const put = (hostId: string, path: string, content: string) => files.set(key(hostId, path), content);
  const get = (hostId: string, path: string) => files.get(key(hostId, path));
  let sequence = 0;
  let failSpawn = false;
  let host = createFakePluginHost({ pluginId: "bots-sidebar", sdk: {
    projects: {
      list: async (args) => args?.includePersonal ? [...projects, personal] : projects,
      get: async ({ projectId }) => { const found = [...projects, personal].find((p) => p.id === projectId); if (!found) throw new Error("Project missing"); return found; },
      create: async () => { throw new Error("Private bot state must never create backing projects"); },
      update: async () => { throw new Error("The bot must not rename projects"); },
    },
    hosts: {
      list: async () => [{ id: "host-home", name: "Execution machine", status: offline.has("host-home") ? "disconnected" : "connected" }],
      directory: async () => { throw new Error("Bot state must not depend on an execution directory"); },
    },
    files: {
      mkdir: async () => { throw new Error("Never create state directories on execution hosts"); },
      read: async ({ hostId, path }) => {
        if (hostId && offline.has(hostId)) throw new Error("Host offline");
        const content = files.get(key(hostId, path)); if (content === undefined) throw new Error(`ENOENT: ${path}`);
        return { content, contentEncoding: "utf8", sha256: hash(content), sizeBytes: Buffer.byteLength(content) };
      },
      write: async () => { throw new Error("Never write bot state to project/execution-host files"); },
    },
    threads: {
      list: async ({ projectId, parentThreadId, archived = false, offset = 0, limit = 100 } = {}) => [...threads.values()].filter((t) => (!projectId || t.projectId === projectId) && (!parentThreadId || t.parentThreadId === parentThreadId) && Boolean(t.archivedAt) === archived).slice(offset, offset + limit),
      get: async ({ threadId }) => { const found = threads.get(threadId); if (!found) throw new Error("Thread missing"); return found; },
      spawn: async (args) => {
        if (failSpawn) throw new Error("Spawn failed");
        const value = makeThreadResponse({ id: `thread-${++sequence}`, projectId: args.projectId, originPluginId: host.bb.pluginId, parentThreadId: args.parentThreadId ?? null, createdAt: Date.now() });
        threads.set(value.id, value);
        const created = await host.harness.behavior.emitThreadEvent("thread.created", { thread: value });
        if (created.errors.length) throw created.errors[0];
        if (!args.sendAt) {
          const blocks = "input" in args ? args.input! : [];
          await host.harness.inspection.registrations.hooks["message.dispatch"]!(makeMessageDispatchHookContext({ thread: value, project: { id: args.projectId }, input: { blocks, text: "" }, originPluginId: host.bb.pluginId, origin: "plugin" }));
          const config = await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: value.id }, project: { id: args.projectId, kind: args.projectId === PERSONAL_ID ? "personal" : "standard" } }));
          initialConfigurations.push({ threadId: value.id, instructions: config.instructions, tools: config.tools.map((tool) => tool.name) });
        }
        return value;
      },
    },
  } });
  await plugin(host.bb);
  let store = createBotStore(host.bb);
  return {
    projects, threads, files, offline, put, get, initialConfigurations,
    get bb() { return host.bb; }, get harness() { return host.harness; }, get store() { return store; },
    stateDirectory(botId: string) { return join(dirname(store.databasePath), "state", botId); },
    seedLegacy(value: unknown) { const parsed = value as { id: string }; host.bb.storage.database().prepare("INSERT OR REPLACE INTO bots(id,data) VALUES (?,?)").run(parsed.id, JSON.stringify(value)); },
    setFailSpawn(value: boolean) { failSpawn = value; },
    async reload() { host = await host.harness.lifecycle.reload(plugin); store = createBotStore(host.bb); },
    async create(name = "Atlas", linkedProjectIds = ["project"]) {
      return await host.harness.behavior.callRpc("bot_create", { name, role: "Research", hostId: "host-home", avatar, sectionId: null, linkedProjectIds, soul: `You are ${name}.` }) as BotMetadata;
    },
  };
}
