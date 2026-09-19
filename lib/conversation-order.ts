// Manual placement wins; unplaced conversations follow in stable newest-first
// creation order. Activity, unread state, and navigation never reshuffle rows.
export function orderConversations<T extends { id: string; createdAt: number }>(threads: readonly T[], order: readonly string[] = []): T[] {
  const ranks = new Map(order.map((id, index) => [id, index]));
  return [...threads].sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity)
    || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

export function conversationRoots<T extends { id: string; parentThreadId: string | null }>(threads: readonly T[]): T[] {
  const ids = new Set(threads.map(thread => thread.id));
  return threads.filter(thread => !thread.parentThreadId || !ids.has(thread.parentThreadId));
}
