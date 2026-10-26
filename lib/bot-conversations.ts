import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { BotMetadata } from "../contract";
import { conversationRoots, orderConversations } from "./conversation-order";

/**
 * A bot's visible conversations, ordered. Ownership is answered in memory over
 * the listed rows with resolveOwner's rule (explicit binding; else a bound
 * parent or source; else continue via `parent ?? source`), so only an ancestor
 * missing from the list costs a lookup.
 */
export async function listBotConversations(
  bb: BbPluginApi, bot: BotMetadata,
  owner: (threadId: string) => string | null,
  resolveOwner: (id: string, persist: boolean) => Promise<string | null>,
) {
  type Row = Awaited<ReturnType<typeof bb.sdk.threads.list>>[number];
  const listed: Row[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await bb.sdk.threads.list({ archived: false, offset, limit: 100 });
    listed.push(...page);
    if (page.length < 100) break;
  }
  const byId = new Map(listed.map((row) => [row.id, row]));
  const known = new Map<string, string | null>();
  async function ownerOf(id: string): Promise<string | null> {
    const chain: string[] = [];
    let current: string | null = id, found: string | null = null;
    while (current && !chain.includes(current)) {
      if (known.has(current)) { found = known.get(current)!; break; }
      const explicit = owner(current);
      if (explicit) { found = explicit; break; }
      const row = byId.get(current);
      if (!row) { found = await resolveOwner(current, false); break; }
      chain.push(current);
      found = (row.parentThreadId && owner(row.parentThreadId)) || (row.sourceThreadId && owner(row.sourceThreadId)) || null;
      if (found) break;
      current = row.parentThreadId ?? row.sourceThreadId;
    }
    // Every thread on the walk shares the answer of the thread that settled it.
    for (const visited of chain) known.set(visited, found);
    return found;
  }
  const rows: Row[] = [];
  for (const row of listed) {
    if (!row.archivedAt && !row.deletedAt && row.visibility !== "hidden" && await ownerOf(row.id) === bot.id) rows.push(row);
  }
  const ordered = orderConversations(rows, bot.threadOrder);
  return { rows: ordered, roots: conversationRoots(ordered) };
}
