import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { ConversationStatusIcon, conversationStatus } from "./conversation-status-icon";

function UnreadBadge({ error, alongsideActivity = false }: { error: boolean; alongsideActivity?: boolean }) {
  const label = error ? "Finished conversation has an unread error" : "Finished conversation is unread";
  return <span className={`bot-done-badge ${error ? "bot-done-badge-error" : ""}`} data-with-activity={alongsideActivity} role="img" aria-label={label} title={label}>
    {error ? <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 2.5v4M6 9h.01" /></svg> : null}
  </span>;
}

export function BotActivityBadge({ threads, mainThreadId }: { threads: readonly PluginSidebarThread[]; mainThreadId: string | null }) {
  const visible = threads.filter((thread) => !thread.isArchived);
  const main = visible.find((thread) => thread.id === mainThreadId);
  const mainStatus = main ? conversationStatus(main) : null;
  const otherWorking = visible.filter((thread) => thread.id !== mainThreadId && conversationStatus(thread).state === "working");
  const unreadError = visible.some((thread) => thread.isUnread && conversationStatus(thread).state === "error");
  const unreadDone = visible.some((thread) => thread.isUnread && ["done", "error"].includes(conversationStatus(thread).state));
  const active = mainStatus?.state === "working" || mainStatus?.state === "waiting" || otherWorking.length > 0;
  if (!active) return unreadDone ? <UnreadBadge error={unreadError} /> : null;

  const mainLabel = mainStatus ? `Main conversation: ${mainStatus.label}` : "Main conversation unavailable";
  const otherLabel = otherWorking.length ? `${otherWorking.length} other conversation${otherWorking.length === 1 ? "" : "s"} working` : "";
  const label = [mainLabel, otherLabel].filter(Boolean).join("; ");
  // Three small slots fit beside the main indicator without spilling outside
  // the avatar. A plus replaces slot three on overflow; the tooltip stays exact.
  const overflow = otherWorking.length > 3;
  const dotCount = overflow ? 2 : otherWorking.length;
  return <>
    <span className="bot-activity-badge" role="img" aria-label={label} title={label} data-other-working-count={otherWorking.length}>
      {Array.from({ length: dotCount }, (_, index) => <span key={index} className="bot-other-working-dot" aria-hidden="true" />)}
      {overflow ? <span className="bot-other-working-overflow" aria-hidden="true">+</span> : null}
      {main ? <span className="bot-main-activity" data-state={mainStatus?.state} aria-hidden="true"><ConversationStatusIcon thread={main} /></span>
        : <span className="bot-main-activity-placeholder" aria-hidden="true" />}
    </span>
    {unreadError && mainStatus?.state !== "error" ? <UnreadBadge error alongsideActivity /> : null}
  </>;
}
