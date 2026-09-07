import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

type DragState = { threadId: string; title: string; botId: string | null };

/** Pointer-based so BB's drag-to-split can still take over outside the sidebar. */
export function useConversationDrop(onDrop: (thread: PluginSidebarThread, botId: string) => void, canDrop: (botId: string) => boolean) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const position = useRef({ x: 0, y: 0 });
  const cancel = useRef<(() => void) | null>(null);
  const clickCleanup = useRef<(() => void) | null>(null);
  const releaseCleanup = useRef<(() => void) | null>(null);
  const callbacks = useRef({ onDrop, canDrop });
  callbacks.current = { onDrop, canDrop };
  useEffect(() => () => { cancel.current?.(); clickCleanup.current?.(); releaseCleanup.current?.(); }, []);

  function swallowClick() {
    clickCleanup.current?.();
    const swallow = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); clear(); };
    const timer = setTimeout(clear, 0);
    function clear() { clearTimeout(timer); window.removeEventListener("click", swallow, true); clickCleanup.current = null; }
    window.addEventListener("click", swallow, true);
    clickCleanup.current = clear;
  }
  function guardCancelledRelease(pointerId: number) {
    releaseCleanup.current?.();
    const up = (event: PointerEvent) => { if (event.pointerId === pointerId) { clear(); swallowClick(); } };
    function clear() { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", clear); window.removeEventListener("blur", clear); releaseCleanup.current = null; }
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", clear);
    window.addEventListener("blur", clear);
    releaseCleanup.current = clear;
  }
  function moveGhost() { if (ghostRef.current) ghostRef.current.style.transform = `translate3d(${position.current.x + 12}px, ${position.current.y + 12}px, 0)`; }
  useEffect(moveGhost, [drag]);

  function begin(thread: PluginSidebarThread, event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || event.pointerType === "touch") return;
    const sidebar = event.currentTarget.closest(".bots-sidebar");
    if (!sidebar) return;
    cancel.current?.(); releaseCleanup.current?.();
    const start = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    let engaged = false;
    let targetId: string | null = null;
    let ended = false;
    const title = thread.title ?? thread.titleFallback ?? "Untitled conversation";
    function targetAt(x: number, y: number) {
      const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-bot-drop-target]");
      const id = target?.dataset.botDropTarget;
      return target && sidebar!.contains(target) && id && callbacks.current.canDrop(id) ? id : null;
    }
    function cleanup() {
      if (ended) return; ended = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelled);
      window.removeEventListener("blur", cancelled);
      document.removeEventListener("keydown", key);
      cancel.current = null; setDrag(null);
    }
    function cancelled() { cleanup(); }
    function key(event: KeyboardEvent) { if (event.key === "Escape") { if (engaged) guardCancelledRelease(start.pointerId); cleanup(); } }
    function move(event: PointerEvent) {
      if (ended || event.pointerId !== start.pointerId) return;
      if (!(event.buttons & 1)) { cancelled(); return; }
      if (!engaged && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
      const first = !engaged; engaged = true;
      event.preventDefault(); position.current = { x: event.clientX, y: event.clientY }; moveGhost();
      const next = targetAt(event.clientX, event.clientY);
      if (first || next !== targetId) { targetId = next; setDrag({ threadId: thread.id, title, botId: next }); }
    }
    function up(event: PointerEvent) {
      if (ended || event.pointerId !== start.pointerId) return;
      // If a live update moved another bot under the pointer, require a new
      // hover/highlight rather than assigning to an unseen replacement target.
      const dropped = engaged && targetId && targetAt(event.clientX, event.clientY) === targetId ? targetId : null;
      if (engaged) swallowClick(); cleanup();
      if (dropped) callbacks.current.onDrop(thread, dropped);
    }
    cancel.current = cancelled;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancelled);
    window.addEventListener("blur", cancelled);
    document.addEventListener("keydown", key);
  }
  return { drag, ghostRef, begin };
}
