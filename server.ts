import { createHash, randomUUID } from "node:crypto";
import type { BbPluginApi, PluginAgentConfigurationContext } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import { rpcContract, stateReadSchema, stateMutationSchema, stateMutationToolSchema, stateMutationResultSchema, normalizeStateMutation, type BotMetadata, type BotStateMutation } from "./contract";
import { createBotStore, EMPTY_HASHES, nextTimestamp } from "./lib/bot-store";
import { applyState, BotStateConflictError, createPrivateBotState, stateContent } from "./lib/private-state";
import { memoryFacts, mutateStateDocument } from "./lib/state-actions";
import { createLegacyImporter } from "./lib/migrate-bots";
import { browseProjectDirectory, createWorkProject } from "./lib/project-creation";
import { registerBotsCli } from "./lib/bots-cli";
import { registerBotMentions } from "./lib/bot-mentions";
import { botProjectContext } from "./lib/project-context";
import { BOT_GUIDANCE, botInstructions } from "./lib/bot-instructions";
import { MEMORY_MAX_CHARS, validateMemory } from "./lib/memory-limit";
export { rpcContract, avatarSchema } from "./contract";
export type { BotAvatar, BotMetadata, BotSection, ProjectCreateInput } from "./contract";

const CHANGED = "project-bots-changed";
const START_MARKER = /^\[bb-bot-start:([a-f0-9-]{36})\]/;
const sha256 = (content: string) => createHash("sha256").update(content).digest("hex");

export default async function plugin(bb: BbPluginApi) {
  const store = createBotStore(bb);
  const publish = () => bb.realtime.publish(CHANGED, { updatedAt: Date.now() });
  const state = createPrivateBotState(bb, store, publish);
  const importLegacy = createLegacyImporter(bb, store);
  let personalId: string | null = null;
  const locks = new Map<string, Promise<unknown>>();
  function serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const run = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
    locks.set(key, run);
    void run.finally(() => { if (locks.get(key) === run) locks.delete(key); }).catch(() => {});
    return run;
  }
  async function personalProjectId() {
    if (personalId) return personalId;
    const project = (await bb.sdk.projects.list({ includePersonal: true })).find((project) => project.kind === "personal");
    if (!project) throw new Error("BB's personal project is unavailable");
    personalId = project.id;
    return personalId;
  }
  // Configuration may inspect a fork before its creation handler finishes.
  // Keep reads pure so they cannot preempt the atomic inherited bind + join.
  function owner(context: { id: string; parentThreadId?: string | null; sourceThreadId?: string | null }) {
    const explicit = store.owner(context.id);
    if (explicit) return explicit;
    const inherited = (context.parentThreadId && store.owner(context.parentThreadId)) || (context.sourceThreadId && store.owner(context.sourceThreadId));
    return inherited || null;
  }
  async function resolveOwner(threadId: string, persist = true): Promise<string | null> {
    const chain: string[] = [];
    let current: string | null = threadId;
    let botId: string | null = null;
    while (current && !chain.includes(current)) {
      const explicit = store.owner(current);
      if (explicit) { botId = explicit; break; }
      const thread = await bb.sdk.threads.get({ threadId: current });
      chain.push(current);
      botId = (thread.parentThreadId && store.owner(thread.parentThreadId)) || (thread.sourceThreadId && store.owner(thread.sourceThreadId)) || null;
      if (botId) break;
      current = thread.parentThreadId ?? thread.sourceThreadId;
    }
    if (botId && persist) for (const id of chain) store.bind(id, botId);
    return botId;
  }
  async function validateLinks(ids: string[]) {
    if (new Set(ids).size !== ids.length) throw new Error("A project can only be linked once");
    const projects = await bb.sdk.projects.list();
    const legacyHomes = new Set(store.list().map((bot) => bot.legacyHomeProjectId));
    for (const id of ids) {
      if (!projects.some((project) => project.id === id && project.kind === "standard") || legacyHomes.has(id)) throw new Error("Link an existing work project, not a legacy bot home");
    }
  }
  function validateSection(id: string | null) {
    if (id !== null && !store.sections().some((section) => section.id === id)) throw new Error("Section no longer exists");
  }
  async function validateConversationProject(bot: BotMetadata, projectId: string) {
    if (projectId !== await personalProjectId() && !bot.linkedProjectIds.includes(projectId)) throw new Error("Choose a projectless conversation or link this project to the bot first");
  }
  function saveBotIdentity({ botId, expectedUpdatedAt, expectedStateHashes, ownedProjectIds, memory, settings, ...fields }: z.infer<typeof rpcContract.bot_update.input>) {
    return serial("registry", () => serial(botId, async () => {
      const bot = await state.prepare(botId);
      if (bot.updatedAt !== expectedUpdatedAt) throw new Error("Bot changed while editing. Reopen the editor or read identity again to avoid overwriting newer changes.");
      if (JSON.stringify(fields.linkedProjectIds) !== JSON.stringify(bot.linkedProjectIds)) await validateLinks(fields.linkedProjectIds);
      if (ownedProjectIds) {
        const existingOwned = new Set(store.ownedProjects(botId));
        await validateLinks(ownedProjectIds.filter((id) => !existingOwned.has(id)));
      }
      if (fields.hostId !== undefined && fields.hostId !== bot.hostId && !(await bb.sdk.hosts.list()).some((host) => host.id === fields.hostId)) throw new Error("Choose an enrolled execution machine");
      validateSection(fields.sectionId);
      const next = store.mutateWithProjects(botId, (current) => {
        if (current.updatedAt !== expectedUpdatedAt) throw new Error("Bot changed while editing. Read the current identity before saving.");
        let next = { ...current, ...fields };
        if (memory !== undefined) next = applyState(next, "MEMORY.md", memory);
        if (settings !== undefined) next = applyState(next, "settings.json", stateContent({ ...next, settings }, "settings.json"));
        for (const file of ["SOUL.md", "MEMORY.md", "settings.json"] as const) {
          if (stateContent(next, file) === stateContent(current, file)) continue;
          if (current.stateHashes[file] !== expectedStateHashes[file]) throw new BotStateConflictError(`${file} changed while editing. Read the current state before saving.`);
        }
        return {
          ...next,
          stateHashes: {
            ...current.stateHashes,
            "SOUL.md": sha256(next.soul),
            ...(memory !== undefined ? { "MEMORY.md": sha256(next.memory) } : {}),
            ...(settings !== undefined ? { "settings.json": sha256(stateContent(next, "settings.json")) } : {}),
          },
          updatedAt: nextTimestamp(current.updatedAt),
        };
      }, ownedProjectIds);
      await state.mirror(next); publish(); return next;
    }));
  }
  async function updateProjectRole(botId: string, action: "join" | "leave" | "own" | "release", projectId: string) {
    return serial("registry", () => serial(botId, async () => {
      store.require(botId);
      if (action === "join" || action === "own") await validateLinks([projectId]);
      const result = store.changeProjectRole(botId, projectId, action);
      if (result.changed) { await state.mirror(result.bot); publish(); }
      return result;
    }));
  }
  type RoutingThread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["get"]>>;
  async function routeNewThread(thread: RoutingThread, atCreation: boolean) {
    const existing = store.owner(thread.id);
    if (existing) return existing;
    // Our creation request carries a durable explicit choice. A fire-and-forget
    // creation event must not let the project default claim it before dispatch.
    if (atCreation && thread.originPluginId === bb.pluginId) return null;
    const inherited = thread.parentThreadId || thread.sourceThreadId ? await resolveOwner(thread.id, false) : null;
    if (inherited) {
      let projectToJoin: string | null = null;
      if (atCreation || thread.status === "pending") {
        const projects = await bb.sdk.projects.list();
        const legacyHome = store.list().some((bot) => bot.legacyHomeProjectId === thread.projectId);
        if (!legacyHome && projects.some((project) => project.id === thread.projectId && project.kind === "standard")) projectToJoin = thread.projectId;
      }
      const adopted = store.adoptInherited(thread.id, inherited, projectToJoin);
      if (adopted.joined) await state.mirror(store.require(adopted.botId));
      if (adopted.changed) publish();
      return adopted.botId;
    }
    if (thread.originPluginId === bb.pluginId || (!atCreation && thread.status !== "pending")) return null;
    const assigned = store.bindProjectDefault(thread.id, thread.projectId, thread.createdAt);
    if (assigned) publish();
    return assigned;
  }

  type StateResult = z.infer<typeof stateMutationResultSchema>;
  type StateView = Omit<StateResult, "changed">;
  function identityView(bot: BotMetadata): StateView {
    return { botId: bot.id, target: "identity", revision: bot.updatedAt, state: { name: bot.name, role: bot.role, soul: bot.soul } };
  }
  async function projectView(bot: BotMetadata, currentProjectId?: string): Promise<StateView> {
    const projects = await bb.sdk.projects.list({ includePersonal: true });
    const legacyHomes = new Set(store.list().map((entry) => entry.legacyHomeProjectId));
    const ownership = (id: string) => { const entry = store.projectOwner(id); return { ownerBotId: entry?.botId ?? null, ownerName: entry ? store.require(entry.botId).name : null }; };
    const available = projects.filter((project) => project.kind === "standard" && !legacyHomes.has(project.id)).map((project) => ({ id: project.id, name: project.name, ...ownership(project.id) }));
    const current = projects.find((project) => project.id === currentProjectId);
    return { botId: bot.id, target: "project", revision: bot.updatedAt, state: { ...(currentProjectId ? { currentProject: current ? botProjectContext(bot, current, store) : null } : {}), linked: bot.linkedProjectIds.map((id) => ({ id, name: projects.find((project) => project.id === id)?.name ?? "Unavailable project", role: store.projectOwner(id)?.botId === bot.id ? "owner" : "member", ...ownership(id) })), available: available.slice(0, 200), availableCount: available.length } };
  }
  function documentView(bot: BotMetadata, target: "memory" | "settings", document: { content: string; sha256: string }): StateView {
    return { botId: bot.id, target, revision: bot.updatedAt, state: target === "memory" ? { ...document, facts: memoryFacts(document.content), characters: document.content.length, maxCharacters: MEMORY_MAX_CHARS } : { sha256: document.sha256, values: JSON.parse(document.content) } };
  }
  async function readBotState(botId: string, input: z.infer<typeof stateReadSchema>, currentProjectId?: string) {
    return serial(botId, async () => {
      if (input.target === "project") return projectView(store.require(botId), currentProjectId);
      const bot = await state.prepare(botId);
      if (input.target === "identity") return identityView(bot);
      return documentView(bot, input.target, await state.read(bot, input.target === "memory" ? "MEMORY.md" : "settings.json"));
    });
  }
  async function applyBotState(botId: string, change: BotStateMutation): Promise<StateResult> {
    if (change.target === "identity") {
      const bot = await serial(botId, () => state.prepare(botId));
      if (bot.updatedAt !== change.expectedRevision) throw new Error("Identity changed. Read identity again and merge your update.");
      const fields = { name: change.name ?? bot.name, role: change.role ?? bot.role, soul: change.soul ?? bot.soul };
      if (Object.entries(fields).every(([key, value]) => bot[key as keyof typeof fields] === value)) return { ...identityView(bot), changed: false };
      const next = await saveBotIdentity({ ...fields, botId, avatar: bot.avatar, sectionId: bot.sectionId, linkedProjectIds: bot.linkedProjectIds, expectedUpdatedAt: change.expectedRevision, expectedStateHashes: bot.stateHashes });
      return { ...identityView(next), changed: true };
    }
    if (change.target === "project") {
      const result = await updateProjectRole(botId, change.action, change.projectId);
      return { ...await projectView(result.bot), changed: result.changed };
    }
    return serial(botId, async () => {
      await state.prepare(botId);
      const file = change.target === "memory" ? "MEMORY.md" : "settings.json";
      if (change.target === "memory" && change.action === "overwrite") {
        // Whole-document replacements must never retry against a newer hash.
        const current = await state.read(store.require(botId), "MEMORY.md");
        validateMemory(change.content);
        if (current.sha256 !== change.expectedSha256) throw new BotStateConflictError('Memory changed. Read it again with bot_read_state({"target":"memory"}), condense the latest content, then overwrite using its sha256.');
        if (change.content === current.content) return { ...documentView(store.require(botId), "memory", current), changed: false };
        const written = await state.update(botId, "MEMORY.md", change.content, change.expectedSha256);
        return { ...documentView(store.require(botId), "memory", written), changed: true };
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const bot = store.require(botId);
        const current = await state.read(bot, file);
        const content = mutateStateDocument(current.content, change);
        if (change.target === "memory") validateMemory(content);
        if (content === current.content) return { ...documentView(bot, change.target, current), changed: false };
        try {
          const written = await state.update(botId, file, content, current.sha256);
          return { ...documentView(store.require(botId), change.target, written), changed: true };
        } catch (error) {
          if (!(error instanceof BotStateConflictError) || attempt === 2) throw error;
        }
      }
      throw new Error("State changed too often; read it again and retry");
    });
  }
  const contextOwner = (ctx: PluginAgentConfigurationContext) => owner(ctx.thread);
  bb.agents.configure((ctx) => {
    const botId = contextOwner(ctx);
    const bot = botId ? store.get(botId) : null;
    return bot ? { tools: ["bot_read_state", "bot_update_state"], skills: [], instructions: botInstructions(bot, botProjectContext(bot, ctx.project, store)) } : { tools: [], skills: [] };
  });
  bb.agents.registerTool({
    name: "bot_read_state", description: "Read this bot's embedded identity and revision, memory facts, settings, or linked/available projects. Supply only target: identity, memory, settings, or project. State is managed privately by BB and is independent of the current machine or working directory.",
    instructions: BOT_GUIDANCE,
    parameters: stateReadSchema,
    execute: async (input, ctx) => {
      const botId = await resolveOwner(ctx.threadId);
      if (!botId) throw new Error("This conversation is not assigned to a bot");
      return JSON.stringify(await readBotState(botId, input, ctx.projectId));
    },
  });
  bb.agents.registerTool({
    name: "bot_update_state", description: "The durable-write gateway for this bot's private state. Always supply target and action. identity/set updates name, role or SOUL using expectedRevision from bot_read_state. memory/append or forget uses one exact single-line fact. Memory is limited to 3000 characters; if full, read memory, condense it, then use memory/overwrite with content and expectedSha256 from that read. Stale replacements fail; read and merge again. settings/set merges selected values; settings/unset removes selected keys. project/join adds membership; leave removes membership and releases ownership. project/own claims an unowned project and joins it; release keeps membership. One owner receives new project threads by default; explicit bot choices win. Existing conversations never move. Scope is always the current bot. State is stored by BB, not in the working directory; do not create state files in projects.",
    parameters: stateMutationToolSchema,
    execute: async (change, ctx) => {
      const botId = await resolveOwner(ctx.threadId);
      if (!botId) throw new Error("This conversation is not assigned to a bot");
      return JSON.stringify(await applyBotState(botId, stateMutationSchema.parse(normalizeStateMutation(change))));
    },
  });
  bb.experimental_hooks.on("message.dispatch", async (ctx) => {
    for (const block of ctx.input.blocks) {
      if (block.type !== "text" || block.visibility !== "agent-only") continue;
      const token = block.text.match(START_MARKER)?.[1];
      if (!token || ctx.thread.originPluginId !== bb.pluginId) continue;
      const start = store.pendingStartContext(token);
      if (!start) continue;
      if (start.projectId === null) await validateConversationProject(store.require(start.botId), ctx.thread.projectId);
      else if (start.projectId !== ctx.thread.projectId) throw new Error("Bot conversation start belongs to a different project");
      store.finishStart(token, ctx.thread.id); publish(); return { action: "proceed" };
    }
    await routeNewThread(ctx.thread, false);
    return { action: "proceed" };
  });
  bb.events.on("thread.created", async ({ thread }) => { await routeNewThread(thread, true); });

  registerBotsCli(bb, store, resolveOwner);
  registerBotMentions(bb, store);

  bb.rpc.register(rpcContract, {
    project_browse: ({ hostId, path }) => browseProjectDirectory(bb, { hostId, path }),
    project_create: (input) => serial("project-create", () => serial(`project-create:${input.requestId}`, () => createWorkProject(bb, store, input))),
    bots_list: async () => {
      const warnings = await importLegacy();
      await Promise.all(store.list().map((bot) => serial(bot.id, () => state.prepare(bot.id))));
      const [hosts, projects] = await Promise.all([bb.sdk.hosts.list(), bb.sdk.projects.list({ includePersonal: true })]);
      const personal = projects.find((project) => project.kind === "personal");
      if (!personal) throw new Error("BB's personal project is unavailable");
      personalId = personal.id;
      const bots = store.list();
      const legacyHomes = new Set(bots.map((bot) => bot.legacyHomeProjectId));
      return { bots, projectOwners: store.projectOwners().map(({ projectId, botId }) => ({ projectId, botId })), warnings: [...warnings, ...state.warnings()], personalProjectId: personalId, threadBindings: store.bindings(), sections: store.sections(), hosts: hosts.map((host) => ({ id: host.id, name: host.name, connected: host.status === "connected" })), projects: projects.filter((project) => project.kind === "standard" && !legacyHomes.has(project.id)).map((project) => ({ id: project.id, name: project.name })) };
    },
    bot_create: ({ name, role, hostId, avatar, sectionId, linkedProjectIds, ownedProjectIds, soul, memory, settings }) => serial("registry", async () => {
      await importLegacy(); await validateLinks(linkedProjectIds); if (ownedProjectIds) await validateLinks(ownedProjectIds); validateSection(sectionId);
      if (!(await bb.sdk.hosts.list()).some((host) => host.id === hostId)) throw new Error("Choose an enrolled execution machine");
      const id = `bot_${randomUUID().replaceAll("-", "")}`;
      let created: BotMetadata = { id, name, role, hostId, stateReady: true, legacyHomeProjectId: null, avatar, sectionId, linkedProjectIds, soul, agents: "", memory: "", settings: {}, stateHashes: { ...EMPTY_HASHES }, order: store.list().length, mainThreadId: null, hiddenUntilActivity: false, hiddenAt: null, updatedAt: Date.now(), legacyProjectId: null };
      if (memory !== undefined) created = applyState(created, "MEMORY.md", memory);
      if (settings !== undefined) created = applyState(created, "settings.json", stateContent({ ...created, settings }, "settings.json"));
      store.saveWithProjects(created, ownedProjectIds);
      const ready = await state.prepare(id); publish(); return ready;
    }),
    bot_prepare: ({ botId }) => serial(botId, () => state.prepare(botId)),
    bot_update: saveBotIdentity,
    bots_reorder: ({ bots: placements }) => serial("registry", async () => {
      const bots = store.list();
      if (placements.length !== bots.length || new Set(placements.map((entry) => entry.botId)).size !== bots.length) throw new Error("Reordering must include every bot exactly once");
      store.saveAll(placements.map(({ botId, sectionId }, order) => { validateSection(sectionId); const bot = store.require(botId); return { ...bot, sectionId, order, updatedAt: nextTimestamp(bot.updatedAt) }; }));
      publish(); return { ok: true } as const;
    }),
    section_create: ({ name }) => serial("registry", async () => { const saved = store.sections(); const section = { id: randomUUID(), name, order: saved.length }; store.saveSections([...saved, section]); publish(); return section; }),
    section_update: ({ sectionId, name }) => serial("registry", async () => {
      const saved = store.sections(); const section = saved.find((section) => section.id === sectionId);
      if (!section) throw new Error("Section no longer exists");
      const next = { ...section, name }; store.saveSections(saved.map((entry) => entry.id === sectionId ? next : entry)); publish(); return next;
    }),
    section_delete: ({ sectionId }) => serial("registry", async () => {
      validateSection(sectionId);
      store.saveAll(store.list().filter((bot) => bot.sectionId === sectionId).map((bot) => ({ ...bot, sectionId: null, updatedAt: nextTimestamp(bot.updatedAt) })));
      store.saveSections(store.sections().filter((section) => section.id !== sectionId)); publish(); return { ok: true } as const;
    }),
    visibility_set: ({ botId, hiddenUntilActivity }) => serial(botId, async () => {
      const bot = store.require(botId); const next = store.save({ ...bot, hiddenUntilActivity, hiddenAt: hiddenUntilActivity ? Date.now() : null, updatedAt: nextTimestamp(bot.updatedAt) }); publish(); return next;
    }),
    main_set: ({ botId, threadId }) => serial(botId, async () => {
      if (await resolveOwner(threadId) !== botId) throw new Error("Conversation does not belong to this bot");
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.archivedAt !== null) throw new Error("Restore this conversation before making it main");
      const latest = store.require(botId);
      const next = store.save({ ...latest, mainThreadId: threadId, updatedAt: nextTimestamp(latest.updatedAt) }); publish(); return next;
    }),
    conversation_create: async ({ botId, request, makeMain }) => {
      if (request.projectId !== await personalProjectId()) await updateProjectRole(botId, "join", request.projectId);
      return serial(botId, async () => {
        const bot = await state.prepare(botId);
        await validateConversationProject(bot, request.projectId);
        const token = randomUUID(); store.stageStart(token, botId, request.projectId);
        const thread = await bb.sdk.threads.spawn({ ...request, input: [...request.input, { type: "text", text: `[bb-bot-start:${token}]\nThis conversation belongs to bot ${bot.name}. Its identity and memory are embedded and managed by bot_read_state / bot_update_state, not files in the working directory.`, mentions: [], visibility: "agent-only" }] });
        store.bind(thread.id, botId); store.cancelStart(token);
        if (makeMain || !store.require(botId).mainThreadId) { const latest = store.require(botId); store.save({ ...latest, mainThreadId: thread.id, updatedAt: nextTimestamp(latest.updatedAt) }); }
        publish(); return { threadId: thread.id };
      });
    },
    conversation_fork: async ({ botId, sourceThreadId, request }) => serial(botId, async () => {
      const bot = await state.prepare(botId);
      const source = await bb.sdk.threads.get({ threadId: sourceThreadId });
      if (source.archivedAt !== null || source.deletedAt !== null) throw new Error("The source conversation is archived or deleted.");
      if (await resolveOwner(sourceThreadId, false) !== botId) throw new Error("The source conversation does not belong to this bot.");
      if (request.environment.type !== "reuse" || !source.environmentId) throw new Error("Forks must reuse the source conversation’s environment.");
      if (request.environment.environmentId !== source.environmentId) throw new Error("The fork environment must match the source conversation.");
      if (request.projectId !== source.projectId) throw new Error("Forks must stay in the source project.");
      const thread = await bb.sdk.threads.fork({ sourceThreadId, environment: request.environment, input: request.input, permissionMode: request.permissionMode });
      store.bind(thread.id, bot.id);
      publish();
      return { threadId: thread.id };
    }),
    conversation_nest: ({ threadId, parentThreadId }) => serial("registry", async () => {
      if (threadId === parentThreadId) throw new Error("A conversation cannot be nested under itself.");
      const thread = await bb.sdk.threads.get({ threadId });
      const parent = await bb.sdk.threads.get({ threadId: parentThreadId });
      if (thread.archivedAt !== null || thread.deletedAt !== null || parent.archivedAt !== null || parent.deletedAt !== null) throw new Error("Archived conversations cannot be nested.");
      const seen = new Set<string>([threadId]);
      let current: string | null = parent.parentThreadId;
      while (current) {
        if (seen.has(current)) throw new Error("That nesting would create a cycle.");
        seen.add(current);
        const ancestor = await bb.sdk.threads.get({ threadId: current });
        current = ancestor.parentThreadId;
      }
      await bb.sdk.threads.update({ threadId, parentThreadId });
      publish();
      return { ok: true } as const;
    }),
    conversation_assign: ({ botId, threadId }) => serial("registry", () => serial(botId, async () => {
      const bot = store.require(botId); const thread = await bb.sdk.threads.get({ threadId });
      const existing = await resolveOwner(threadId, false);
      if (existing && existing !== botId) throw new Error("Conversation already belongs to another bot");
      if (store.owner(threadId) === botId) return { ok: true } as const;
      const needsLink = thread.projectId !== await personalProjectId() && thread.projectId !== bot.legacyHomeProjectId && !bot.linkedProjectIds.includes(thread.projectId);
      if (needsLink) await validateLinks([thread.projectId]);
      // Membership and the new association commit together; a competing binding
      // must win without leaving an unwanted membership behind.
      const assigned = store.adoptInherited(threadId, botId, needsLink ? thread.projectId : null);
      if (assigned.botId !== botId) throw new Error("Conversation already belongs to another bot");
      if (assigned.joined) await state.mirror(store.require(botId));
      if (assigned.changed) publish();
      return { ok: true } as const;
    })),
    state_read: ({ botId, file }) => serial(botId, async () => state.read(await state.prepare(botId), file)),
    state_update: ({ botId, file, content, expectedSha256 }) => serial(botId, async () => { await state.prepare(botId); return state.update(botId, file, content, expectedSha256); }),
    state_apply: ({ botId, change }) => applyBotState(botId, change),
  });
}
