import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { BotMetadata } from "../contract";
import { conversationRoots, orderConversations } from "./conversation-order";

export async function listBotConversations(bb: BbPluginApi, bot: BotMetadata, resolveOwner: (id: string, persist: boolean) => Promise<string | null>) {
  const rows: Awaited<ReturnType<typeof bb.sdk.threads.list>> = [];
  for (let offset = 0; ; offset += 100) {
    const page = await bb.sdk.threads.list({ archived: false, offset, limit: 100 });
    for (const row of page) {
      if (!row.archivedAt && !row.deletedAt && row.visibility !== "hidden" && await resolveOwner(row.id, false) === bot.id) rows.push(row);
    }
    if (page.length < 100) break;
  }
  const ordered = orderConversations(rows, bot.threadOrder);
  return { rows: ordered, roots: conversationRoots(ordered) };
}
