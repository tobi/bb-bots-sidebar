import type { BotAvatar } from "./appearance";

export const BORED_AFTER_MS = 30 * 60_000;
export const SLEEPY_AFTER_MS = 2 * 60 * 60_000;
export const GLANCE_MIN_MS = 5 * 60_000;
export const GLANCE_MAX_MS = 12 * 60_000;
export const GLANCE_DURATION_MIN_MS = 3_000;
export const GLANCE_DURATION_MAX_MS = 5_000;

const RECENT_EXPRESSIONS: BotAvatar["expression"][] = ["curious", "neutral", "happy", "surprised", "confused", "proud", "shy"];
const IDLE_EXPRESSIONS: BotAvatar["expression"][] = ["unimpressed", "sleepy"];

export function idleExpression(base: BotAvatar["expression"], idleMs: number): BotAvatar["expression"] {
  if (idleMs >= SLEEPY_AFTER_MS) return "sleepy";
  if (idleMs >= BORED_AFTER_MS) return "unimpressed";
  return base;
}

export function expressionGlance(base: BotAvatar["expression"], idleMs: number, random = Math.random): BotAvatar["expression"] {
  const current = idleExpression(base, idleMs);
  const choices = (idleMs >= BORED_AFTER_MS ? IDLE_EXPRESSIONS : RECENT_EXPRESSIONS).filter(expression => expression !== current);
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]!;
}

export function glanceDelay(random = Math.random) { return GLANCE_MIN_MS + Math.floor(random() * (GLANCE_MAX_MS - GLANCE_MIN_MS)); }
export function glanceDuration(random = Math.random) { return GLANCE_DURATION_MIN_MS + Math.floor(random() * (GLANCE_DURATION_MAX_MS - GLANCE_DURATION_MIN_MS)); }
