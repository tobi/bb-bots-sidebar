import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { isWorking } from "../lib/conversations";

export function conversationStatus(thread: PluginSidebarThread) {
  // Pending input takes precedence; background work must not look completed
  // just because the foreground turn has produced an unread result.
  const state = thread.hasPendingInteraction || thread.indicator === "waiting-for-input" ? "waiting"
    : isWorking(thread) ? "working"
    : thread.indicator === "unread-error" ? "error"
    : thread.indicator === "draft" ? "draft"
    : thread.indicator === "none" || thread.indicator === "unread-success" ? "done"
    : "unknown";
  const label = {
    waiting: "Waiting for input",
    working: "Working",
    error: "Finished with an error",
    draft: "Draft",
    done: "Done",
    unknown: "Conversation status unavailable",
  }[state] + (thread.isUnread ? " — unread" : "");

  return { state, label };
}

export function ConversationStatusIcon({ thread }: { thread: PluginSidebarThread }) {
  const { state, label } = conversationStatus(thread);
  return <svg
    className={`conversation-status conversation-status-${state}`}
    data-unread={thread.isUnread}
    width="14" height="14" viewBox="0 0 16 16"
    fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
    role="img" aria-label={label}
  >
    <title>{label}</title>
    {state === "working" ? <>
      <circle cx="8" cy="8" r="5.5" opacity="0.2" />
      <path d="M8 2.5A5.5 5.5 0 0 1 13.5 8" />
    </> : null}
    {state === "done" ? <circle cx="8" cy="8" r={thread.isUnread ? 3 : 2} fill="currentColor" stroke="none" /> : null}
    {state === "error" ? <><circle cx="8" cy="8" r="5.5" /><path d="m6 6 4 4m0-4-4 4" /></> : null}
    {state === "waiting" ? <><circle cx="8" cy="8" r="5.5" /><path d="M6.3 6v4M9.7 6v4" /></> : null}
    {state === "draft" ? <path d="m3 10 7-7 3 3-7 7H3v-3Zm5-5 3 3" /> : null}
    {state === "unknown" ? <circle cx="8" cy="8" r="3" /> : null}
  </svg>;
}
