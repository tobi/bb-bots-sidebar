import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BotAvatar } from "../lib/appearance";
import { BORED_AFTER_MS, SLEEPY_AFTER_MS, expressionGlance, glanceDelay, glanceDuration, idleExpression } from "../lib/idle-expression";
import { usePrefersReducedMotion } from "../components/ui/hooks/use-media-query";

function subscribeVisibility(notify: () => void) {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
}
const isVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
function activityTime(value: number | null, now: number) { return value !== null && Number.isFinite(value) && value > 0 ? Math.min(value, now) : null; }

type Input = { botId: string; expression: BotAvatar["expression"]; motion: BotAvatar["motion"]; awake: boolean; lastActivityAt: number | null };

/** Presentation only. One timeout per idle bot; no intervals, metadata writes, or editor effects. */
export function useIdleExpression({ botId, expression, motion, awake, lastActivityAt }: Input): BotAvatar["expression"] {
  const reducedMotion = usePrefersReducedMotion();
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, () => true);
  const now = Date.now();
  const lastKnownActivity = useRef(activityTime(lastActivityAt, now) ?? now);
  const previous = useRef({ botId, expression, awake });
  const [frame, setFrame] = useState<{ key: string; expression: BotAvatar["expression"] } | null>(null);
  const key = JSON.stringify([botId, expression, motion, awake, lastActivityAt, reducedMotion, visible]);

  useEffect(() => {
    const started = Date.now();
    const reported = activityTime(lastActivityAt, started);
    const changedBot = previous.current.botId !== botId;
    if (changedBot) lastKnownActivity.current = reported ?? started;
    else {
      // Archiving/removing recent rows must not rewind the local idle clock.
      if (reported !== null) lastKnownActivity.current = Math.max(lastKnownActivity.current, reported);
      if (awake || previous.current.awake || previous.current.expression !== expression) lastKnownActivity.current = Math.max(lastKnownActivity.current, started);
    }
    previous.current = { botId, expression, awake };
    const since = lastKnownActivity.current;
    const publish = (value: BotAvatar["expression"]) => setFrame(current => current?.key === key && current.expression === value ? current : { key, expression: value });
    if (awake || !visible) { publish(expression); return; }

    const allowGlances = !reducedMotion && motion !== "still";
    let nextGlance = allowGlances ? started + glanceDelay() : Infinity;
    let transient: { expression: BotAvatar["expression"]; until: number } | null = null;
    let baseline = idleExpression(expression, started - since);
    let timer: ReturnType<typeof setTimeout> | undefined;
    function tick() {
      const time = Date.now();
      const idleMs = Math.max(0, time - since);
      const nextBaseline = idleExpression(expression, idleMs);
      if (baseline !== nextBaseline || (transient && time >= transient.until)) transient = null;
      baseline = nextBaseline;
      if (time >= nextGlance) {
        transient = { expression: expressionGlance(expression, idleMs), until: time + glanceDuration() };
        nextGlance = transient.until + glanceDelay();
      }
      publish(transient?.expression ?? baseline);
      const deadline = Math.min(nextGlance, transient?.until ?? Infinity,
        since + BORED_AFTER_MS > time ? since + BORED_AFTER_MS : Infinity,
        since + SLEEPY_AFTER_MS > time ? since + SLEEPY_AFTER_MS : Infinity);
      if (Number.isFinite(deadline)) timer = setTimeout(tick, Math.max(1, deadline - time));
    }
    tick();
    return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [botId, expression, motion, awake, lastActivityAt, reducedMotion, visible, key]);

  // A new activity/configuration render must never show a stale timed pose,
  // even for the frame before the effect cancels its old timer.
  if (awake || !visible) return expression;
  if (frame?.key === key) return frame.expression;
  if (previous.current.botId === botId && (previous.current.awake || previous.current.expression !== expression)) return expression;
  const since = previous.current.botId === botId
    ? Math.max(lastKnownActivity.current, activityTime(lastActivityAt, now) ?? 0)
    : activityTime(lastActivityAt, now) ?? now;
  return idleExpression(expression, now - since);
}
