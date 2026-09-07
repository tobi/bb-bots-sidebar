import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { avatarSchema } from "../contract";
import {
  AVATAR_COLORS,
  AVATAR_EXPRESSION_IDS,
  AVATAR_MOTION_IDS,
  AVATAR_SHAPE_IDS,
  isNeutralPresetColor,
  paletteColorForSeed,
  randomAvatar,
  shapePath,
} from "../lib/appearance";

it("exposes 8 shapes, 16 expressions, 3 motions, and 14 chromatic colors", () => {
  expect(AVATAR_SHAPE_IDS).toHaveLength(8);
  expect(AVATAR_EXPRESSION_IDS).toHaveLength(16);
  expect(AVATAR_MOTION_IDS).toEqual(["calm", "playful", "still"]);
  expect(AVATAR_COLORS).toHaveLength(14);
  expect(new Set(AVATAR_COLORS).size).toBe(14);
});

it("keeps no black, white, or gray presets", () => {
  expect(AVATAR_COLORS).not.toContain("#0a0a0c");
  expect(AVATAR_COLORS).not.toContain("#f1efe9");
  expect(AVATAR_COLORS).not.toContain("#a3a3a3");
  expect(AVATAR_COLORS).not.toContain("#000000");
  expect(AVATAR_COLORS).not.toContain("#ffffff");
  for (const color of AVATAR_COLORS) expect(isNeutralPresetColor(color)).toBe(false);
});

it("accepts legacy avatars and the expanded enum superset, including custom hex", () => {
  expect(avatarSchema.parse({ color: "#168b75", shape: "round", expression: "curious", motion: "still" })).toBeTruthy();
  expect(avatarSchema.parse({ color: "#0a0a0c", shape: "blob", expression: "happy", motion: "calm" }).color).toBe("#0a0a0c");
  expect(avatarSchema.parse({ color: "#abcdef", shape: "cloud", expression: "unimpressed", motion: "playful" }).shape).toBe("cloud");
  expect(() => avatarSchema.parse({ color: "#168b75", shape: "star", expression: "curious", motion: "calm" })).toThrow();
});

it("preserves the original three shape paths", () => {
  expect(shapePath("round")).toBe("M50 4A46 46 0 1 1 49.99 4Z");
  expect(shapePath("blob")).toBe("M50 4C69 2 89 13 94 32C99 51 91 76 74 89C58 101 32 96 17 82C2 68 3 43 12 25C20 9 34 6 50 4Z");
  expect(shapePath("squircle")).toBe("M50 5C70 5 82 6 90 14C98 22 99 34 99 50C99 66 98 78 90 86C82 94 70 95 50 95C30 95 18 94 10 86C2 78 1 66 1 50C1 34 2 22 10 14C18 6 30 5 50 5Z");
});

it("gives every new shape a distinct path", () => {
  const paths = AVATAR_SHAPE_IDS.map((shape) => shapePath(shape));
  expect(new Set(paths).size).toBe(8);
});

it("keeps the droplet bulb inside y<=96", () => {
  const path = shapePath("droplet");
  const startY = Number(/([\d.]+)A/.exec(path)?.[1]);
  const radius = Number(/A([\d.]+)/.exec(path)?.[1]);
  expect(startY + radius).toBeLessThanOrEqual(96);
});

it("does not import zod so the app can load options without the schema", () => {
  expect(readFileSync(new URL("../lib/appearance.ts", import.meta.url), "utf8")).not.toMatch(/from ["']zod["']/);
});

it("randomizes all four fields from the option lists and never rolls a neutral preset", () => {
  const sizes = [AVATAR_COLORS.length, AVATAR_SHAPE_IDS.length, AVATAR_EXPRESSION_IDS.length, AVATAR_MOTION_IDS.length];
  let i = 0;
  const random = () => {
    const lane = i % 4;
    const tick = Math.floor(i / 4);
    i += 1;
    return ((tick % sizes[lane]!) + 0.5) / sizes[lane]!;
  };
  const shapes = new Set<string>();
  const expressions = new Set<string>();
  const motions = new Set<string>();
  const colors = new Set<string>();
  for (let n = 0; n < 16; n++) {
    const avatar = randomAvatar(random);
    expect(AVATAR_SHAPE_IDS).toContain(avatar.shape);
    expect(AVATAR_EXPRESSION_IDS).toContain(avatar.expression);
    expect(AVATAR_MOTION_IDS).toContain(avatar.motion);
    expect(AVATAR_COLORS).toContain(avatar.color);
    expect(isNeutralPresetColor(avatar.color)).toBe(false);
    shapes.add(avatar.shape);
    expressions.add(avatar.expression);
    motions.add(avatar.motion);
    colors.add(avatar.color);
  }
  expect(shapes.size).toBe(8);
  expect(expressions.size).toBe(16);
  expect(motions.size).toBe(3);
  expect(colors.size).toBe(14);
});

it("uses the chromatic palette for migration fallbacks, never ink", () => {
  const color = paletteColorForSeed("bot_ffffffffffffffff");
  expect(AVATAR_COLORS).toContain(color);
  expect(color).not.toBe("#0a0a0c");
  expect(isNeutralPresetColor(color)).toBe(false);
});
