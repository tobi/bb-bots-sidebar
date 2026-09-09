import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function BotNewConversationButton({ name, onClick }: { name: string; onClick: () => void }) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button type="button" variant="ghost" size="icon" className="bot-new-conversation h-6 w-6 shrink-0 p-0 text-muted-foreground" aria-label={`New conversation with ${name}`} draggable={false}
        onPointerDown={(event) => {
          event.stopPropagation();
          // Cancel the compatibility mousedown so the draggable parent cannot
          // take over a button gesture. Keep focus, keyboard and touch intact.
          if (event.pointerType === "mouse" && event.button === 0) {
            event.preventDefault(); event.currentTarget.focus();
          }
        }}
        onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); onClick(); }}>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
      </Button>
    </TooltipTrigger>
    <TooltipContent>New conversation with {name}</TooltipContent>
  </Tooltip>;
}
