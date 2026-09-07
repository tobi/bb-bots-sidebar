// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { useIdleExpression } from "../hooks/use-idle-expression";
import { SidebarBotIcon } from "../components/sidebar-bot-icon";
import { BotIcon } from "../components/bot-icon";
import { BORED_AFTER_MS, SLEEPY_AFTER_MS, GLANCE_MIN_MS, GLANCE_MAX_MS, GLANCE_DURATION_MIN_MS, expressionGlance, glanceDelay, glanceDuration, idleExpression } from "../lib/idle-expression";
import { bot, thread } from "./fixtures";

const NOW = 1_800_000_000_000;
let visible = true;
let reduced = false;
let mediaListeners = new Set<() => void>();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] }); vi.setSystemTime(NOW);
  vi.spyOn(Math, "random").mockReturnValue(0);
  visible = true; reduced = false; mediaListeners = new Set();
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible ? "visible" : "hidden");
  vi.stubGlobal("matchMedia", (query: string) => ({ media: query, get matches() { return query.includes("prefers-reduced-motion") && reduced; }, onchange: null,
    addEventListener: (_event: string, listener: () => void) => { if (query.includes("prefers-reduced-motion")) mediaListeners.add(listener); },
    removeEventListener: (_event: string, listener: () => void) => { mediaListeners.delete(listener); },
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const input = () => ({ botId: "bot", expression: "curious" as const, motion: "calm" as const, awake: false, lastActivityAt: NOW as number | null });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
function visibility(next: boolean) { act(() => { visible = next; document.dispatchEvent(new Event("visibilitychange")); }); }

it("uses bored after 30 minutes and sleepy after two hours", () => {
  expect(idleExpression("happy", BORED_AFTER_MS - 1)).toBe("happy");
  expect(idleExpression("happy", BORED_AFTER_MS)).toBe("unimpressed");
  expect(idleExpression("happy", SLEEPY_AFTER_MS)).toBe("sleepy");
  expect(glanceDelay(() => 0)).toBe(GLANCE_MIN_MS);
  expect(glanceDelay(() => 0.999)).toBeLessThan(GLANCE_MAX_MS);
  expect(glanceDuration(() => 0)).toBe(3000);
  expect(glanceDuration(() => 0.999)).toBeLessThan(5000);
  expect(expressionGlance("curious", 0, () => 0)).not.toBe("curious");
  expect(expressionGlance("happy", BORED_AFTER_MS, () => 0)).toBe("sleepy");
  expect(expressionGlance("happy", SLEEPY_AFTER_MS, () => 0)).toBe("unimpressed");
});

it("waits minutes between short temporary looks, then returns to the saved expression", () => {
  const { result } = renderHook(() => useIdleExpression(input()));
  expect(result.current).toBe("curious"); expect(vi.getTimerCount()).toBe(1);
  advance(GLANCE_MIN_MS - 1); expect(result.current).toBe("curious");
  advance(1); expect(result.current).toBe("neutral");
  advance(GLANCE_DURATION_MIN_MS); expect(result.current).toBe("curious");
  advance(GLANCE_MIN_MS - 1); expect(result.current).toBe("curious");
  advance(1); expect(result.current).toBe("neutral");
  expect(vi.getTimerCount()).toBe(1);
});

it("does not reschedule on unrelated renders", () => {
  const { result, rerender } = renderHook(props => useIdleExpression(props), { initialProps: input() });
  advance(GLANCE_MIN_MS / 2); rerender({ ...input() });
  advance(GLANCE_MIN_MS / 2); expect(result.current).toBe("neutral");
});

it("does not synchronize each bot's random looks", () => {
  const first = renderHook(() => useIdleExpression(input()));
  vi.mocked(Math.random).mockReturnValueOnce(0.999);
  const second = renderHook(() => useIdleExpression({ ...input(), botId: "second" }));
  advance(GLANCE_MIN_MS);
  expect(first.result.current).toBe("neutral"); expect(second.result.current).toBe("curious");
});

it("returns to the chosen face immediately when work starts and restarts idle age when it finishes", () => {
  const props = { ...input(), motion: "still" as const, lastActivityAt: NOW - SLEEPY_AFTER_MS };
  const { result, rerender } = renderHook(value => useIdleExpression(value), { initialProps: props });
  expect(result.current).toBe("sleepy");
  rerender({ ...props, awake: true }); expect(result.current).toBe("curious"); expect(vi.getTimerCount()).toBe(0);
  advance(SLEEPY_AFTER_MS); expect(result.current).toBe("curious");
  rerender({ ...props, awake: false }); expect(result.current).toBe("curious");
  advance(BORED_AFTER_MS - 1); expect(result.current).toBe("curious");
  advance(1); expect(result.current).toBe("unimpressed");
});

it("new conversation activity cancels a temporary look", () => {
  const { result, rerender } = renderHook(value => useIdleExpression(value), { initialProps: input() });
  advance(GLANCE_MIN_MS); expect(result.current).toBe("neutral");
  rerender({ ...input(), lastActivityAt: Date.now() }); expect(result.current).toBe("curious");
  advance(GLANCE_MIN_MS - 1); expect(result.current).toBe("curious");
});

it.each(["still", "reduced"])("keeps long-idle poses but disables random bursts for %s", (mode) => {
  reduced = mode === "reduced";
  const { result } = renderHook(() => useIdleExpression({ ...input(), motion: mode === "still" ? "still" : "calm" }));
  advance(10 * 60_000); expect(result.current).toBe("curious");
  advance(20 * 60_000); expect(result.current).toBe("unimpressed");
  advance(90 * 60_000); expect(result.current).toBe("sleepy");
  expect(vi.getTimerCount()).toBe(0);
});

it("reacts to reduced-motion changes and cancels an in-progress random look", () => {
  const { result } = renderHook(() => useIdleExpression(input()));
  advance(GLANCE_MIN_MS); expect(result.current).toBe("neutral");
  act(() => { reduced = true; for (const listener of [...mediaListeners]) listener(); });
  expect(result.current).toBe("curious");
  advance(GLANCE_MIN_MS); expect(result.current).toBe("curious");
});

it("pauses while hidden and resumes without replaying missed looks", () => {
  const { result, unmount } = renderHook(() => useIdleExpression(input()));
  advance(GLANCE_MIN_MS); expect(result.current).toBe("neutral");
  visibility(false); expect(vi.getTimerCount()).toBe(0);
  advance(4 * 60 * 60_000); expect(vi.getTimerCount()).toBe(0);
  visibility(true); expect(result.current).toBe("sleepy");
  advance(GLANCE_MIN_MS - 1); expect(result.current).toBe("sleepy");
  advance(1); expect(result.current).toBe("unimpressed");
  unmount(); expect(vi.getTimerCount()).toBe(0); expect(mediaListeners.size).toBe(0);
});

it("does not treat bots without history as ancient or rewind age when recent rows disappear", () => {
  const props = { ...input(), motion: "still" as const, lastActivityAt: null as number | null };
  const { result, rerender } = renderHook(value => useIdleExpression(value), { initialProps: props });
  expect(result.current).toBe("curious");
  advance(10 * 60_000); rerender({ ...props, lastActivityAt: NOW - SLEEPY_AFTER_MS });
  expect(result.current).toBe("curious");
  advance(20 * 60_000); expect(result.current).toBe("unimpressed");
});

it("honors a newly saved expression instead of leaving a stale idle face", () => {
  const props = { ...input(), expression: "curious" as "curious" | "happy", motion: "still" as const, lastActivityAt: NOW - SLEEPY_AFTER_MS };
  const { result, rerender } = renderHook(value => useIdleExpression(value), { initialProps: props });
  expect(result.current).toBe("sleepy");
  rerender({ ...props, expression: "happy" }); expect(result.current).toBe("happy");
  advance(BORED_AFTER_MS - 1); expect(result.current).toBe("happy");
});

it.each([
  { indicator: "runtime" as const },
  { activity: { workflows: 0, backgroundAgents: 1, backgroundCommands: 0, planMode: 0, goals: 0 } },
  { hasPendingInteraction: true },
  { indicator: "waiting-for-input" as const },
  { indicator: "unread-error" as const, isUnread: true },
])("keeps the bot alert for work or attention anywhere in its conversations: %j", overrides => {
  const rows = [thread("main", NOW - SLEEPY_AFTER_MS), thread("other", NOW - SLEEPY_AFTER_MS, overrides)];
  const { container } = render(<SidebarBotIcon botId="bot" avatar={bot.avatar} threads={rows} idleVariant={0} selected={false} />);
  expect(container.querySelector("svg")?.getAttribute("data-expression")).toBe(bot.avatar.expression);
});

it("changes only the sidebar expression, leaving saved metadata and editor/picker previews untouched", () => {
  const avatar = Object.freeze({ ...bot.avatar, motion: "calm" as const });
  const { container } = render(<><SidebarBotIcon botId="bot" avatar={avatar} threads={[thread("main", NOW - SLEEPY_AFTER_MS)]} idleVariant={0} selected={false} /><BotIcon avatar={avatar} label="Saved preview" /></>);
  expect(container.querySelector("svg")?.getAttribute("data-expression")).toBe("sleepy");
  expect(container.querySelector('[aria-label="Saved preview"]')?.getAttribute("data-expression")).toBe("curious");
  expect(avatar.expression).toBe("curious");
  expect(container.querySelector("svg")?.getAttribute("data-color")).toBe(avatar.color);
  expect(container.querySelector("svg")?.getAttribute("data-shape")).toBe(avatar.shape);
});
