import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useConversationDrop } from "./use-conversation-drop";

export function useConversationReorder(threads: PluginSidebarThread[], onReorder: (source: string, target: string, position: "before" | "after") => void, onNest: (source: string, target: string) => void, botId: string, firstThreadId?: string) {
  const byId = new Map(threads.map(thread => [thread.id, thread]));
  const parent = (thread: PluginSidebarThread) => thread.parentThreadId && byId.has(thread.parentThreadId) ? thread.parentThreadId : null;
  const drop = useConversationDrop((thread, value) => {
    const target = JSON.parse(value) as { id: string; position: "before" | "after" | "inside" };
    if (target.position === "inside") onNest(thread.id, target.id);
    else onReorder(thread.id, target.id, target.position);
  }, () => true, (source, element, _x, y, shiftKey) => {
    const botRow = element.closest<HTMLElement>("[data-bot-drop-target]");
    if (botRow) {
      if (botRow.dataset.botDropTarget !== botId || parent(source) !== null || !firstThreadId || source.id === firstThreadId) return null;
      return JSON.stringify({ id: firstThreadId, position: "before", botRow: true });
    }
    const li = element.closest<HTMLElement>("[data-thread-drop-target]");
    const target = byId.get(li?.dataset.threadDropTarget ?? "");
    if (!li || !target || source.id === target.id || (!shiftKey && parent(source) !== parent(target))) return null;
    // Do not offer a nesting drop that would make a cycle.
    if (shiftKey) {
      let ancestor: PluginSidebarThread | undefined = target;
      const seen = new Set<string>();
      while (ancestor && !seen.has(ancestor.id)) {
        if (ancestor.id === source.id) return null;
        seen.add(ancestor.id); ancestor = byId.get(ancestor.parentThreadId ?? "");
      }
    }
    const bounds = li.querySelector(".thread-row")?.getBoundingClientRect();
    if (!bounds) return null;
    return JSON.stringify({ id: target.id, position: shiftKey ? "inside" : y > bounds.top + bounds.height / 2 ? "after" : "before" });
  });
  const target = drop.drag?.botId ? JSON.parse(drop.drag.botId) as { id: string; position: "before" | "after" | "inside"; botRow?: boolean } : null;
  return { ...drop, target };
}
