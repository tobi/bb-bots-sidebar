import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { useMemo } from "react";
import { useWorkflowRuns } from "../workflow-runs";
import { ChatScopeContext, type ChatScope } from "./chat-scope";
import { ThreadList } from "./upstream/app";

export function ChatThreadList({ scope, ...props }: PluginThreadListProps & { scope: ChatScope }) {
  const workflowRuns = useWorkflowRuns();
  const context = useMemo(() => ({ ...scope, activeThreadId: props.activeThreadId }), [scope, props.activeThreadId]);
  const treeActiveId = workflowRuns.ownerOf(props.activeThreadId) ?? props.activeThreadId;
  return <ChatScopeContext.Provider value={context}>
    <div className="chat-thread-list h-full min-h-0">
      <ThreadList {...props} activeThreadId={treeActiveId} />
    </div>
  </ChatScopeContext.Provider>;
}
