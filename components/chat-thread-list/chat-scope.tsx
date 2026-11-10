import { createContext, useContext, useMemo } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { PluginSidebarThread, PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import { conversationOwners } from "../../lib/conversations";

export interface ChatScope {
  bindings: readonly { threadId: string; botId: string }[];
  detached: ReadonlySet<string>;
  ready: boolean;
  /** Actual viewed thread; the native tree uses its owner for workflow agents. */
  activeThreadId?: string | null;
  draggingThreadId?: string | null;
  onAssign(thread: PluginSidebarThread): void;
  onPointerDown(thread: PluginSidebarThread, event: ReactPointerEvent<HTMLElement>): void;
}

export const ChatScopeContext = createContext<ChatScope | null>(null);

export function filterChatThreads(state: PluginSidebarThreadsState, scope: Pick<ChatScope, "bindings" | "detached" | "ready">): PluginSidebarThreadsState {
  if (!scope.ready) return { ...state, status: "loading", threads: [] };
  const owners = conversationOwners(state.threads, scope.bindings, scope.detached);
  return { ...state, threads: state.threads.filter(thread => !owners.has(thread.id)) };
}

export function useChatSidebarState(state: PluginSidebarThreadsState) {
  const scope = useContext(ChatScopeContext);
  return useMemo(() => scope ? filterChatThreads(state, scope) : state, [state, scope]);
}

export function useChatScope() {
  return useContext(ChatScopeContext);
}
