import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { ChatScopeContext, type ChatScope } from "./chat-scope";
import { ThreadList } from "./upstream/app";

export function ChatThreadList({ scope, ...props }: PluginThreadListProps & { scope: ChatScope }) {
  return <ChatScopeContext.Provider value={scope}>
    <div className="chat-thread-list h-full min-h-0">
      <ThreadList {...props} />
    </div>
  </ChatScopeContext.Provider>;
}
