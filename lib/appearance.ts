/**
 * Compact 2D avatar options adapted from bloub (MIT), not the simulation engine.
 * See THIRD_PARTY_NOTICES.md. Pure module: no zod, so the app can import options
 * without pulling the contract schema.
 */

export const AVATAR_SHAPE_IDS = ["round", "blob", "squircle", "capsule", "triangle", "hexagon", "cloud", "droplet"] as const;
export const AVATAR_EXPRESSION_IDS = [
  "curious", "happy", "focused", "sleepy",
  "neutral", "surprised", "excited", "laughing", "angry", "sad", "scared",
  "suspicious", "confused", "proud", "shy", "unimpressed",
] as const;
export const AVATAR_MOTION_IDS = ["calm", "playful", "still"] as const;

/** Existing five chromatic fills plus bloub’s nine chromatic colors. No ink/cream/gray. */
export const AVATAR_COLORS = [
  "#6d5efc", "#e44f67", "#168b75", "#cb7428", "#2f6dcc",
  "#8b5e3c", "#e8483f", "#f08a24", "#f0b429", "#3ecf8e",
  "#2fbfa0", "#3b93f0", "#8b5cf6", "#e152b0",
] as const;

export const AVATAR_COLOR_LABELS: Record<(typeof AVATAR_COLORS)[number], string> = {
  "#6d5efc": "Violet",
  "#e44f67": "Rose",
  "#168b75": "Teal",
  "#cb7428": "Copper",
  "#2f6dcc": "Blue",
  "#8b5e3c": "Brown",
  "#e8483f": "Red",
  "#f08a24": "Orange",
  "#f0b429": "Amber",
  "#3ecf8e": "Green",
  "#2fbfa0": "Turquoise",
  "#3b93f0": "Sky",
  "#8b5cf6": "Purple",
  "#e152b0": "Pink",
};

export const AVATAR_SHAPES: Array<{ id: (typeof AVATAR_SHAPE_IDS)[number]; label: string }> = [
  { id: "round", label: "Orb" },
  { id: "blob", label: "Bloub" },
  { id: "squircle", label: "Soft square" },
  { id: "capsule", label: "Capsule" },
  { id: "triangle", label: "Triangle" },
  { id: "hexagon", label: "Hexagon" },
  { id: "cloud", label: "Cloud" },
  { id: "droplet", label: "Droplet" },
];

export const AVATAR_EXPRESSIONS: Array<{ id: (typeof AVATAR_EXPRESSION_IDS)[number]; label: string }> = [
  { id: "curious", label: "Curious" },
  { id: "happy", label: "Happy" },
  { id: "focused", label: "Focused" },
  { id: "sleepy", label: "Sleepy" },
  { id: "neutral", label: "Neutral" },
  { id: "surprised", label: "Surprised" },
  { id: "excited", label: "Excited" },
  { id: "laughing", label: "Laughing" },
  { id: "angry", label: "Angry" },
  { id: "sad", label: "Sad" },
  { id: "scared", label: "Scared" },
  { id: "suspicious", label: "Suspicious" },
  { id: "confused", label: "Confused" },
  { id: "proud", label: "Proud" },
  { id: "shy", label: "Shy" },
  { id: "unimpressed", label: "Unimpressed" },
];

export const AVATAR_MOTIONS: Array<{ id: (typeof AVATAR_MOTION_IDS)[number]; label: string }> = [
  { id: "calm", label: "Calm" },
  { id: "playful", label: "Playful" },
  { id: "still", label: "Still" },
];

export type AvatarShape = (typeof AVATAR_SHAPE_IDS)[number];
export type AvatarExpression = (typeof AVATAR_EXPRESSION_IDS)[number];
export type AvatarMotion = (typeof AVATAR_MOTION_IDS)[number];
export type BotAvatar = {
  color: string;
  shape: AvatarShape;
  expression: AvatarExpression;
  motion: AvatarMotion;
};

const ROUND_PATH = "M50 4A46 46 0 1 1 49.99 4Z";
const BLOB_PATH = "M50 4C69 2 89 13 94 32C99 51 91 76 74 89C58 101 32 96 17 82C2 68 3 43 12 25C20 9 34 6 50 4Z";
const SQUIRCLE_PATH = "M50 5C70 5 82 6 90 14C98 22 99 34 99 50C99 66 98 78 90 86C82 94 70 95 50 95C30 95 18 94 10 86C2 78 1 66 1 50C1 34 2 22 10 14C18 6 30 5 50 5Z";

export function shapePath(shape: BotAvatar["shape"]): string {
  if (shape === "blob") return BLOB_PATH;
  if (shape === "squircle") return SQUIRCLE_PATH;
  if (shape === "capsule") return "M26 30H74A20 20 0 0 1 74 70H26A20 20 0 0 1 26 30Z";
  if (shape === "triangle") return "M50 10L90 86H10Z";
  if (shape === "hexagon") return "M50 8L86 29V71L50 92L14 71V29Z";
  if (shape === "cloud") {
    return "M18 58C10 58 8 46 18 42C16 28 32 22 42 30C48 16 72 16 80 30C94 28 98 46 88 52C96 62 88 74 74 70C66 80 38 80 28 68C16 72 12 64 18 58Z";
  }
  if (shape === "droplet") return "M50 8C76 32 80 48 80 66A30 30 0 1 1 20 66C20 48 24 32 50 8Z";
  return ROUND_PATH;
}

/** Keep eyes inside pointed/wide silhouettes; identity for the original three shapes. */
export function eyeFitTransform(shape: BotAvatar["shape"]): string | undefined {
  if (shape === "capsule") return "translate(50 50) scale(0.82 0.92) translate(-50 -50)";
  if (shape === "triangle") return "translate(50 62) scale(0.66) translate(-50 -45)";
  if (shape === "hexagon") return "translate(50 50) scale(0.84) translate(-50 -50)";
  if (shape === "cloud") return "translate(50 56) scale(0.76) translate(-50 -45)";
  if (shape === "droplet") return "translate(50 60) scale(0.7) translate(-50 -45)";
  return undefined;
}

export function isNeutralPresetColor(hex: string): boolean {
  const value = Number.parseInt(hex.slice(1), 16);
  if (!Number.isFinite(value)) return false;
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return Math.max(r, g, b) - Math.min(r, g, b) < 14;
}

export function paletteColorForSeed(seed: string): (typeof AVATAR_COLORS)[number] {
  const n = Number.parseInt(seed.slice(-2), 16);
  const index = Number.isFinite(n) ? n : 0;
  return AVATAR_COLORS[index % AVATAR_COLORS.length]!;
}

function pick<T>(items: readonly T[], random: () => number): T {
  const index = Math.min(items.length - 1, Math.max(0, Math.floor(random() * items.length)));
  return items[index]!;
}

/** One full roll of color/shape/expression/motion. Caller must lazy-init so drafts stay put. */
export function randomAvatar(random: () => number = Math.random): BotAvatar {
  return {
    color: pick(AVATAR_COLORS, random),
    shape: pick(AVATAR_SHAPE_IDS, random),
    expression: pick(AVATAR_EXPRESSION_IDS, random),
    motion: pick(AVATAR_MOTION_IDS, random),
  };
}
