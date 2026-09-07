import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

// Stable client preference keys: intentionally retained after the plugin-ID
// change to bots-sidebar so existing heights/collapsed state do not reset.
const HEIGHT_KEY = "bots:chats-height";
const COLLAPSED_KEY = "bots:chats-collapsed";
const MIN_HEIGHT = 80;
const MIN_BOTS_HEIGHT = 100;
const DEFAULT_HEIGHT = 170;

function storedHeight() {
  try {
    const value = Number(localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(value) && value >= MIN_HEIGHT ? Math.min(2000, value) : DEFAULT_HEIGHT;
  } catch { return DEFAULT_HEIGHT; }
}
function storedCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === "true"; } catch { return false; }
}

export function ResizableChats({ children, onNewChat, activeChatId }: { children: ReactNode; onNewChat: () => void; activeChatId: string | null }) {
  const [height, setHeight] = useState(storedHeight);
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  const [maxHeight, setMaxHeight] = useState(600);
  const sectionRef = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const previousActive = useRef(activeChatId);
  const contentId = useId();
  const visibleHeight = Math.min(height, maxHeight);
  const resize = (value: number) => setHeight(Math.round(Math.max(MIN_HEIGHT, Math.min(maxHeight, value))));

  useEffect(() => {
    const parent = sectionRef.current?.parentElement;
    if (!parent) return;
    const update = () => {
      const available = parent.getBoundingClientRect().height;
      if (available > 0) setMaxHeight(Math.max(MIN_HEIGHT, available - MIN_BOTS_HEIGHT));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { try { localStorage.setItem(HEIGHT_KEY, String(height)); } catch { /* Optional client preference. */ } }, [height]);
  useEffect(() => { try { localStorage.setItem(COLLAPSED_KEY, String(collapsed)); } catch { /* Optional client preference. */ } }, [collapsed]);
  useEffect(() => {
    if (activeChatId && activeChatId !== previousActive.current) setCollapsed(false);
    previousActive.current = activeChatId;
  }, [activeChatId]);

  return <section ref={sectionRef} className="recent-section flex min-h-0 shrink-0 flex-col" style={{ height: collapsed ? undefined : visibleHeight }}>
    {!collapsed ? <div
      className="chats-resize-handle"
      role="separator" tabIndex={0} aria-label="Resize Chats" aria-orientation="horizontal"
      aria-valuemin={MIN_HEIGHT} aria-valuemax={maxHeight} aria-valuenow={visibleHeight}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { pointerId: event.pointerId, y: event.clientY, height: visibleHeight };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start && start.pointerId === event.pointerId) resize(start.height + start.y - event.clientY);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={(event) => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        resize(event.key === "Home" ? MIN_HEIGHT : event.key === "End" ? maxHeight : visibleHeight + (event.key === "ArrowUp" ? 16 : -16));
      }}
    /> : <div className="border-t border-border" />}
    <div className="flex shrink-0 items-center justify-between px-1 py-1">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground" aria-expanded={!collapsed} aria-controls={contentId} onClick={() => setCollapsed((current) => !current)}>
        <span>Chats</span>
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={collapsed ? "" : "rotate-90"}><path d="m7 5 5 5-5 5" /></svg>
      </button>
      <button type="button" className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground" aria-label="New unconnected chat" onClick={() => { setCollapsed(false); onNewChat(); }}>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 4v12M4 10h12" /></svg>
      </button>
    </div>
    <div id={contentId} className="min-h-0 flex-1 overflow-y-auto" hidden={collapsed}>{collapsed ? null : children}</div>
  </section>;
}
