import { useCallback, useEffect, useRef, useState } from "react";
import { experimental_DetailRow as DetailRow, experimental_InfoSection as InfoSection, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { ExperimentalThreadInfoProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract, ThreadBot, ThreadBotPrompt } from "../contract";
import { BotIcon } from "./bot-icon";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger } from "./ui/select";
import { cn } from "../lib/utils";

const NONE = "__no_bot__";
export const BOTS_CHANGED = "project-bots-changed";

/** Which bot a thread belongs to, kept live across bot and binding changes. */
export function useThreadBot(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [value, setValue] = useState<ThreadBot | null>(null);
  const [pending, setPending] = useState(false);
  const sequence = useRef(0);
  const refresh = useCallback(() => {
    const current = ++sequence.current;
    return rpc.call("thread_bot", { threadId }).then(
      (result) => { if (current === sequence.current) setValue(result); },
      () => { /* Keep the last known bot; the sidebar reports real failures. */ },
    );
  }, [rpc, threadId]);
  useEffect(() => { setValue(null); void refresh(); return () => { sequence.current++; }; }, [refresh]);
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (connection === "connected" && previous.current !== "connected") void refresh();
    previous.current = connection;
  }, [connection, refresh]);
  useRealtime(BOTS_CHANGED, () => { void refresh(); });
  const choose = useCallback(async (botId: string | null) => {
    setPending(true);
    try {
      const result = await rpc.call("conversation_set_bot", { threadId, botId });
      await refresh();
      if (result.threadIds.length) {
        const name = botId ? value?.bots.find((bot) => bot.id === botId)?.name ?? "bot" : null;
        const extra = result.threadIds.length > 1 ? ` with ${result.threadIds.length - 1} child conversation${result.threadIds.length === 2 ? "" : "s"}` : "";
        toast.success(name ? `Moved to ${name}${extra}` : `Removed from bot${extra}`);
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }, [rpc, threadId, refresh, value]);
  return { value, pending, choose };
}

function NoBotGlyph({ size }: { size: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="shrink-0 opacity-60"><rect x="4" y="6" width="12" height="10" rx="3" strokeDasharray="2.2 2" /><path d="M10 6V3.5" /></svg>;
}

function ThreadBotSelect({ threadId, variant, compact = false }: { threadId: string; variant: "header" | "info"; compact?: boolean }) {
  const { value, pending, choose } = useThreadBot(threadId);
  if (!value) return null;
  const current = value.bots.find((bot) => bot.id === value.botId) ?? null;
  const size = variant === "header" ? 16 : 14;
  const label = current ? current.name : "No bot";
  const visible = value.bots.filter((bot) => !bot.hidden || bot.id === value.botId);
  const hidden = value.bots.filter((bot) => bot.hidden && bot.id !== value.botId);
  const item = (bot: ThreadBot["bots"][number]) => (
    <SelectItem key={bot.id} value={bot.id} className="text-xs">
      <span className="flex min-w-0 items-center gap-2"><BotIcon avatar={bot.avatar} size={16} /><span className="truncate">{bot.name}</span>{bot.role ? <><span className="sr-only">, </span><span className="truncate text-muted-foreground">{bot.role}</span></> : null}</span>
    </SelectItem>
  );
  return (
    <Select value={value.botId ?? NONE} disabled={pending} onValueChange={(next) => { void choose(next === NONE ? null : next); }}>
      <SelectTrigger
        aria-label={current ? `Bot: ${current.name}. Change bot` : "No bot. Assign to a bot"}
        title={current ? `${current.name}${value.explicit ? "" : " (inherited from the parent conversation)"}` : value.detached ? "Removed from its bot" : "Not assigned to a bot"}
        className={cn(
          "thread-bot-trigger w-auto max-w-[14rem] gap-1.5 border-0 bg-transparent shadow-none focus:ring-0 focus-visible:ring-1 [&>svg:last-child]:size-3.5",
          variant === "header" ? "h-7 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground" : "h-auto min-h-0 rounded-sm p-0 text-sm text-foreground hover:underline hover:underline-offset-2",
          !current && "text-muted-foreground",
        )}
      >
        {/* A div: the trigger line-clamps direct span children, which breaks flex. */}
        <div className="flex min-w-0 items-center gap-1.5">
          {current ? <BotIcon avatar={current.avatar} size={size} label={current.name} /> : <NoBotGlyph size={size} />}
          {compact ? null : <div className="truncate">{label}</div>}
        </div>
      </SelectTrigger>
      <SelectContent align={variant === "header" ? "end" : "start"} className="min-w-[12rem]">
        <SelectItem value={NONE} className="text-xs"><span className="flex items-center gap-2 text-muted-foreground"><NoBotGlyph size={16} />No bot</span></SelectItem>
        {visible.length ? <SelectSeparator /> : null}
        {visible.map(item)}
        {hidden.length ? <><SelectSeparator /><div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Hidden</div>{hidden.map(item)}</> : null}
      </SelectContent>
    </Select>
  );
}

/** Thread header: assign the thread to a bot or to none, whichever sidebar is shown. */
export function ThreadBotHeaderAction({ threadId, isCompactViewport }: { threadId: string; isCompactViewport: boolean }) {
  return <ThreadBotSelect threadId={threadId} variant="header" compact={isCompactViewport} />;
}

/** Thread Info tab: the bot beside BB's own Parent row. */
export function ThreadBotInfoRow({ threadId }: ExperimentalThreadInfoProps) {
  return <DetailRow label="Bot" icon="Bot"><ThreadBotSelect threadId={threadId} variant="info" /></DetailRow>;
}

/** What the thread's bot adds to the agent's system prompt, kept live like the picker. */
function useThreadBotPrompt(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [value, setValue] = useState<ThreadBotPrompt | null>(null);
  const sequence = useRef(0);
  const refresh = useCallback(() => {
    const current = ++sequence.current;
    return rpc.call("thread_bot_prompt", { threadId }).then(
      (result) => { if (current === sequence.current) setValue(result); },
      () => { /* Keep the last known prompt. */ },
    );
  }, [rpc, threadId]);
  useEffect(() => { setValue(null); void refresh(); return () => { sequence.current++; }; }, [refresh]);
  useRealtime(BOTS_CHANGED, () => { void refresh(); });
  return value;
}

function PromptBlock({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bot-prompt-block">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 rounded-sm py-1 text-left text-xs text-muted-foreground hover:text-foreground">
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" className={cn("shrink-0 transition-transform", open && "rotate-90")}><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="text-foreground">{title}</span>
        <span className="tabular-nums">{text.length.toLocaleString()} chars</span>
      </button>
      {open ? <pre className="mb-1 ml-[18px] max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed text-foreground">{text}</pre> : null}
    </div>
  );
}

/** Thread Info tab: the system-prompt additions from the thread's bot, each block folded. */
export function ThreadBotPromptSection({ threadId }: ExperimentalThreadInfoProps) {
  const value = useThreadBotPrompt(threadId);
  if (!value?.botId) return null;
  return (
    <InfoSection label="Bot prompt">
      <div className="flex flex-col">
        {value.sections.map((section) => <PromptBlock key={section.id} title={section.title} text={section.text} />)}
        <p className="mt-1 text-[11px] text-muted-foreground">Tools: {value.tools.join(", ")} · Skill: {value.skills.join(", ")}</p>
      </div>
    </InfoSection>
  );
}
