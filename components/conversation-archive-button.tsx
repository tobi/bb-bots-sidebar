import type { PluginSidebarThread, PluginSidebarThreadActions } from "@get-bb/plugin-sdk/app";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function ConversationArchiveButton({ thread, actions }: { thread: PluginSidebarThread; actions: Pick<PluginSidebarThreadActions, "archive"> }) {
  const title = thread.title ?? thread.titleFallback ?? "Untitled conversation";
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button type="button" variant="ghost" size="icon" className="conversation-archive h-6 w-6 shrink-0 p-0 text-muted-foreground" aria-label={`Archive ${title}`} data-archive-thread-id={thread.id}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); actions.archive(thread.id); }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8v12h16V8M3 4h18v4H3zM10 12h4" /></svg>
      </Button>
    </TooltipTrigger>
    <TooltipContent>Archive conversation and its children</TooltipContent>
  </Tooltip>;
}
