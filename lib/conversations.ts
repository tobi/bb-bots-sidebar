import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { orderConversations } from "./conversation-order";

const WORKING_INDICATORS = new Set(["runtime", "workflow", "background-agent", "background-command", "plan-mode", "goal", "working-draft"]);

export function isWorking(thread: PluginSidebarThread): boolean {
  return WORKING_INDICATORS.has(thread.indicator) || Object.values(thread.activity).some((count) => count > 0);
}

// Ownership is explicit (or inherited from the nearest bound ancestor), never
// inferred from a project: several independent bots can link the same project.
export function conversationOwners(
  threads: readonly PluginSidebarThread[],
  bindings: readonly { threadId: string; botId: string }[],
): Map<string, string> {
  const direct = new Map(bindings.map(({ threadId, botId }) => [threadId, botId]));
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const owners = new Map<string, string>();
  for (const thread of threads) {
    let id: string | null = thread.id;
    const visited = new Set<string>();
    while (id && !visited.has(id)) {
      visited.add(id);
      const owner = direct.get(id);
      if (owner) { owners.set(thread.id, owner); break; }
      id = byId.get(id)?.parentThreadId ?? null;
    }
  }
  return owners;
}

function buildConversationTree(threads: readonly PluginSidebarThread[], mainThreadId: string | null, activeThreadId: string | null) {
  const rows = threads.filter((thread) => !thread.isArchived && thread.id !== mainThreadId);
  const byId = new Map(rows.map((thread) => [thread.id, thread]));
  const childrenByParent = new Map<string, PluginSidebarThread[]>();
  const roots: PluginSidebarThread[] = [];
  for (const thread of rows) {
    if (thread.parentThreadId && (thread.parentThreadId === mainThreadId || byId.has(thread.parentThreadId))) {
      const children = childrenByParent.get(thread.parentThreadId) ?? [];
      children.push(thread);
      childrenByParent.set(thread.parentThreadId, children);
    } else {
      roots.push(thread);
    }
  }

  const activePath = new Set<string>();
  if (mainThreadId && activeThreadId === mainThreadId) activePath.add(mainThreadId);
  let active = activeThreadId ? byId.get(activeThreadId) : undefined;
  while (active && !activePath.has(active.id)) {
    activePath.add(active.id);
    if (mainThreadId && active.parentThreadId === mainThreadId) { activePath.add(mainThreadId); break; }
    active = active.parentThreadId ? byId.get(active.parentThreadId) : undefined;
  }

  // A busy/recent child keeps its whole tree visible, not just its own row.
  const summaries = new Map<string, { activity: number; keepVisible: boolean; busy: boolean; selected: boolean; pinned: boolean }>();
  function summarize(thread: PluginSidebarThread) {
    const cached = summaries.get(thread.id);
    if (cached) return cached;
    const summary = {
      activity: Math.max(thread.updatedAt, thread.latestAttentionAt),
      busy: thread.hasPendingInteraction || thread.indicator === "waiting-for-input" || isWorking(thread),
      selected: thread.id === activeThreadId,
      pinned: thread.isPinned,
      keepVisible: thread.id === activeThreadId || thread.isUnread || thread.isPinned || thread.hasPendingInteraction || thread.indicator === "waiting-for-input" || isWorking(thread),
    };
    summaries.set(thread.id, summary);
    for (const child of childrenByParent.get(thread.id) ?? []) {
      const childSummary = summarize(child);
      summary.activity = Math.max(summary.activity, childSummary.activity);
      summary.keepVisible ||= childSummary.keepVisible;
      summary.busy ||= childSummary.busy;
      summary.selected ||= childSummary.selected;
      summary.pinned ||= childSummary.pinned;
    }
    return summary;
  }
  for (const thread of rows) summarize(thread);
  const byActivity = (a: PluginSidebarThread, b: PluginSidebarThread) => summaries.get(b.id)!.activity - summaries.get(a.id)!.activity || a.id.localeCompare(b.id);
  roots.sort(byActivity);
  for (const children of childrenByParent.values()) children.sort(byActivity);
  return {
    childrenByParent,
    activePath,
    roots,
    mainChildren: mainThreadId ? childrenByParent.get(mainThreadId) ?? [] : [],
    summaries,
  };
}

// Chats retains its existing recent/attention policy.
export function conversationTree(threads: readonly PluginSidebarThread[], mainThreadId: string | null, activeThreadId: string | null, recentLimit = 4) {
  const { summaries, ...tree } = buildConversationTree(threads, mainThreadId, activeThreadId);
  return {
    ...tree,
    recent: tree.roots.filter((thread, index) => index < recentLimit || summaries.get(thread.id)!.keepVisible),
    other: tree.roots.filter((thread, index) => index >= recentLimit && !summaries.get(thread.id)!.keepVisible),
  };
}

export function orderedBotConversationTree(threads: readonly PluginSidebarThread[], order: readonly string[] = [], activeThreadId: string | null = null) {
  const tree = buildConversationTree(threads, null, activeThreadId);
  return {
    roots: orderConversations(tree.roots, order),
    activePath: tree.activePath,
    childrenByParent: new Map([...tree.childrenByParent].map(([id, children]) => [id, orderConversations(children, order)])),
  };
}
