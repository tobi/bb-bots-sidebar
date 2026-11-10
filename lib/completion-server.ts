import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { BotStore } from "./bot-store";
import { conversationRoots, orderConversations } from "./conversation-order";
import {
  decideCompletion, descendantIds, hiddenCompletedIds, normalizeCompletionSettings,
  type CompletionRecord, type CompletionSettings, type CompletionThread,
} from "./completion";

type SdkThread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number];

const TURN_IN_FLIGHT = new Set(["active", "pending", "starting", "stopping"]);

/** Live work, a pending question, or queued input keeps a conversation open. */
export function sdkThreadBusy(thread: SdkThread): boolean {
  // Older hosts or partial rows may omit activity fields; absent means none.
  const activity: Partial<SdkThread["activity"]> & { activeGoalCount?: number } = thread.activity ?? {};
  const queued = thread.queuedWork ?? "none";
  return TURN_IN_FLIGHT.has(thread.status) || thread.hasPendingInteraction === true || queued !== "none"
    || (activity.activeWorkflowCount ?? 0) > 0 || (activity.activeBackgroundAgentCount ?? 0) > 0 || (activity.activeBackgroundCommandCount ?? 0) > 0
    || (activity.activePlanModeCount ?? 0) > 0 || (activity.activeGoalCount ?? 0) > 0;
}

export function toCompletionThread(thread: SdkThread): CompletionThread {
  return {
    id: thread.id, parentThreadId: thread.parentThreadId, createdAt: thread.createdAt, updatedAt: thread.updatedAt,
    latestAttentionAt: thread.latestAttentionAt, pinned: thread.pinnedAt !== null, busy: sdkThreadBusy(thread),
  };
}

/** Explicit bindings, else the nearest bound ancestor: the sidebar's ownership rule. */
export function ownersByThread(threads: readonly { id: string; parentThreadId: string | null }[], owner: (threadId: string) => string | null) {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const owners = new Map<string, string>();
  for (const thread of threads) {
    let id: string | null = thread.id;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const bound = owner(id);
      if (bound) { owners.set(thread.id, bound); break; }
      id = byId.get(id)?.parentThreadId ?? null;
    }
  }
  return owners;
}

/** The first ordered visible root: the bot's click target and protected main. */
export function mainConversationId<T extends CompletionThread & { createdAt: number }>(threads: readonly T[], order: readonly string[] | undefined, records: ReadonlyMap<string, CompletionRecord>): string | null {
  const hidden = hiddenCompletedIds(threads, records);
  const shown = threads.filter((thread) => !hidden.has(thread.id));
  return conversationRoots(orderConversations(shown, order))[0]?.id ?? null;
}

export function createCompletion(bb: BbPluginApi, store: BotStore, publish: () => void, liveWorkflowOwners: () => Promise<ReadonlySet<string>> = async () => new Set()) {
  const db = bb.storage.database();
  // thread_completion is created by the bot store's append-only migrations.
  const settingsHandle = bb.settings.define({
    autoComplete: { type: "boolean", label: "Auto-complete idle bot conversations", description: "Hide a bot's conversation once it has been idle for the configured time. Its first conversation is never completed automatically. New activity brings a conversation back.", default: true },
    autoCompleteAfterHours: { type: "number", label: "Auto-complete after (hours idle)", description: "1–2160 hours. Default 72 (3 days).", default: 72 },
    autoArchive: { type: "boolean", label: "Auto-archive completed bot conversations", description: "Archive completed conversations (and their children) after the configured number of days. Never archives a bot's first conversation or anything pinned or working.", default: false },
    autoArchiveAfterDays: { type: "number", label: "Auto-archive after (days completed)", description: "0–365 days. 0 archives as soon as a conversation is completed. Default 7.", default: 7 },
  });
  const readSettings = async (): Promise<CompletionSettings> => normalizeCompletionSettings(await settingsHandle.get());

  const rows = () => (db.prepare("SELECT thread_id AS threadId, completed_at AS completedAt, reopened_at AS reopenedAt FROM thread_completion").all() as CompletionRecord[]);
  const records = () => new Map(rows().map((row) => [row.threadId, row]));
  const upsert = db.prepare("INSERT INTO thread_completion(thread_id, completed_at, reopened_at) VALUES (?, ?, ?) ON CONFLICT(thread_id) DO UPDATE SET completed_at = excluded.completed_at, reopened_at = excluded.reopened_at");
  const markCompleted = db.transaction((ids: readonly string[], at: number) => {
    for (const id of ids) upsert.run(id, at, null);
  });
  /** Explicit un-complete: always restart the idle clock. */
  const reopen = (threadId: string, at = Date.now()) => { upsert.run(threadId, null, at); };
  /** Activity only touches conversations that are currently completed. */
  const reopenCompleted = (threadId: string, at = Date.now()): boolean =>
    db.prepare("UPDATE thread_completion SET completed_at = NULL, reopened_at = ? WHERE thread_id = ? AND completed_at IS NOT NULL").run(at, threadId).changes > 0;

  async function listThreads(): Promise<SdkThread[]> {
    const result: SdkThread[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await bb.sdk.threads.list({ archived: false, offset, limit: 100 });
      result.push(...page.filter((thread) => thread.archivedAt === null && thread.deletedAt === null && thread.visibility !== "hidden"));
      if (page.length < 100) break;
    }
    return result;
  }

  function botThreads(threads: readonly SdkThread[]) {
    const owners = ownersByThread(threads, store.owner);
    const byBot = new Map<string, SdkThread[]>();
    for (const thread of threads) {
      const botId = owners.get(thread.id);
      if (!botId) continue;
      const list = byBot.get(botId) ?? [];
      list.push(thread);
      byBot.set(botId, list);
    }
    return { owners, byBot };
  }

  let running: Promise<{ completed: string[]; archived: string[] }> | null = null;
  function evaluate() {
    running ??= (async () => {
      try {
        const settings = await readSettings();
        if (!settings.autoComplete && !settings.autoArchive) return { completed: [], archived: [] };
        const [threads, workflowOwners] = await Promise.all([listThreads(), liveWorkflowOwners()]);
        const { byBot } = botThreads(threads);
        const now = Date.now();
        const current = records();
        const completed: string[] = [];
        const archived: string[] = [];
        for (const [botId, list] of byBot) {
          const bot = store.get(botId);
          if (!bot) continue;
          // A running BB workflow keeps the conversation that started it open.
          const view = list.map((thread) => { const row = toCompletionThread(thread); return workflowOwners.has(row.id) ? { ...row, busy: true } : row; });
          const mainId = mainConversationId(view, bot.threadOrder, current);
          const decision = decideCompletion({ threads: view, records: current, mainId, now, settings });
          completed.push(...decision.complete);
          archived.push(...decision.archive);
        }
        if (completed.length) { markCompleted(completed, now); publish(); }
        for (const threadId of archived) {
          try { await bb.sdk.threads.archive({ threadId }); }
          catch (error) { bb.log.warn(`Could not auto-archive ${threadId}: ${error instanceof Error ? error.message : String(error)}`); }
        }
        return { completed, archived };
      } finally { running = null; }
    })();
    return running;
  }

  /** Manually complete a conversation and its subtree, or reopen just this one. */
  async function setCompleted(threadId: string, completed: boolean) {
    const now = Date.now();
    if (!completed) { reopen(threadId, now); publish(); return { ok: true as const, threadIds: [threadId] }; }
    const threads = await listThreads();
    const target = threads.find((thread) => thread.id === threadId);
    if (!target) throw new Error("This conversation is archived or no longer available.");
    const ids = [threadId, ...descendantIds(threads, threadId)];
    markCompleted(ids, now); publish();
    const settings = await readSettings();
    if (settings.autoArchive && settings.autoArchiveAfterDays === 0) void evaluate().catch(() => {});
    return { ok: true as const, threadIds: ids };
  }

  bb.background.schedule("auto-complete", "*/15 * * * *", async () => { await evaluate(); });
  settingsHandle.onChange(() => { void evaluate().catch((error) => bb.log.warn(`Auto-complete evaluation failed: ${error instanceof Error ? error.message : String(error)}`)); });
  // Real activity reopens a completed conversation and restarts its idle clock.
  bb.events.on("thread.active", ({ thread }) => { if (reopenCompleted(thread.id)) publish(); });
  bb.events.on("interaction.pending", ({ thread }) => { if (reopenCompleted(thread.id)) publish(); });
  bb.events.on("thread.unarchived", ({ thread }) => { if (reopenCompleted(thread.id)) publish(); });
  bb.events.on("thread.deleted", ({ thread }) => {
    if (db.prepare("DELETE FROM thread_completion WHERE thread_id = ?").run(thread.id).changes) publish();
  });

  return {
    /** Workflow progress on a conversation counts as its own activity. */
    reopenForActivity: (threadId: string) => { if (reopenCompleted(threadId)) publish(); },
    records,
    evaluate,
    setCompleted,
    completions: () => rows().filter((row) => row.completedAt !== null).map(({ threadId, completedAt }) => ({ threadId, completedAt: completedAt! })),
    readSettings,
  };
}
