import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { AVATAR_EXPRESSION_IDS, AVATAR_MOTION_IDS, AVATAR_SHAPE_IDS } from "./lib/appearance";
import { newThreadRequestSchema } from "./lib/new-thread-request";

import { MEMORY_MAX_CHARS, MEMORY_LIMIT_ERROR } from "./lib/memory-limit";

const id = z.string().min(1);
export const avatarSchema = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  shape: z.enum(AVATAR_SHAPE_IDS),
  expression: z.enum(AVATAR_EXPRESSION_IDS),
  motion: z.enum(AVATAR_MOTION_IDS),
}).strict();
export type BotAvatar = z.infer<typeof avatarSchema>;
export const stateFileSchema = z.enum(["SOUL.md", "MEMORY.md", "settings.json"]);
export type BotStateFile = z.infer<typeof stateFileSchema>;
export const stateHashesSchema = z.object({ "SOUL.md": z.string().nullable(), "AGENTS.md": z.string().nullable(), "MEMORY.md": z.string().nullable(), "settings.json": z.string().nullable() }).strict();
export const metadataSchema = z.object({
  id, name: z.string().min(1).max(120), role: z.string().max(80), avatar: avatarSchema,
  hostId: id, stateReady: z.boolean(), legacyHomeProjectId: id.nullable(), linkedProjectIds: z.array(id),
  mainThreadId: id.nullable(), hiddenUntilActivity: z.boolean(), hiddenAt: z.number().nullable(),
  sectionId: id.nullable(), order: z.number().int().nonnegative(),
  // agents and its hash are archived compatibility data, never injected or editable.
  // Keep the old read limit so oversized existing memory can be read and condensed.
  soul: z.string().max(4096), agents: z.string().max(4096), memory: z.string().max(16384), settings: z.record(z.string(), z.json()),
  stateHashes: stateHashesSchema, updatedAt: z.number(), legacyProjectId: id.nullable(),
}).strict();
export type BotMetadata = z.infer<typeof metadataSchema>;
export const sectionSchema = z.object({ id, name: z.string().min(1).max(80), order: z.number().int().nonnegative() }).strict();
export type BotSection = z.infer<typeof sectionSchema>;
const hostSchema = z.object({ id, name: z.string(), connected: z.boolean() }).strict();
const projectSchema = z.object({ id, name: z.string() }).strict();
const hostPathSchema = z.string().trim().min(1).max(4096).refine((value) => !value.includes("\0"), "Path must not contain NUL");
export const projectCreateInputSchema = z.object({
  requestId: z.uuid(), name: z.string().trim().min(1).max(120), hostId: id, path: hostPathSchema,
}).strict();
export type ProjectCreateInput = z.infer<typeof projectCreateInputSchema>;
export const projectBrowseInputSchema = z.object({ hostId: id, path: hostPathSchema.optional() }).strict();
export const projectBrowseOutputSchema = z.object({
  directory: z.string(), parent: z.string().nullable(),
  entries: z.array(z.object({ name: z.string(), path: z.string() }).strict()), truncated: z.boolean(),
}).strict();
export const projectOwnerSchema = z.object({ projectId: id, botId: id }).strict();
export type ProjectOwner = z.infer<typeof projectOwnerSchema>;
const settingsObjectSchema = z.record(z.string(), z.json()).refine((value) => `${JSON.stringify(value, null, 2)}\n`.length <= 16384, "settings.json is too large");
const memoryInputSchema = z.string().max(MEMORY_MAX_CHARS, MEMORY_LIMIT_ERROR);
const editFields = { name: z.string().trim().min(1).max(120), role: z.string().trim().max(80), avatar: avatarSchema, sectionId: id.nullable(), linkedProjectIds: z.array(id).max(100), ownedProjectIds: z.array(id).max(100).optional(), soul: z.string().max(4096), memory: memoryInputSchema.optional(), settings: settingsObjectSchema.optional() };
const stateOutput = z.object({ botId: id, file: stateFileSchema, content: z.string(), sha256: z.string() }).strict();
export const stateUpdateSchema = z.object({ file: stateFileSchema, content: z.string(), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().superRefine((value, ctx) => {
  const limit = value.file === "MEMORY.md" ? MEMORY_MAX_CHARS : value.file === "SOUL.md" ? 4096 : 16384;
  if (value.content.length > limit) ctx.addIssue({ code: "custom", path: ["content"], message: value.file === "MEMORY.md" ? MEMORY_LIMIT_ERROR : `${value.file} is too large` });
});
export const stateTargetSchema = z.enum(["identity", "memory", "settings", "project"]);
export const stateReadSchema = z.object({ target: stateTargetSchema }).strict();
const settingKey = z.string().min(1).max(120).refine((key) => !["__proto__", "prototype", "constructor"].includes(key), "Reserved setting key");
export const stateMutationSchema = z.union([
  z.object({ target: z.literal("identity"), action: z.literal("set"), expectedRevision: z.number().int().nonnegative(), name: z.string().trim().min(1).max(120).optional(), role: z.string().trim().max(80).optional(), soul: z.string().max(4096).optional() }).strict().refine((value) => [value.name, value.role, value.soul].some((field) => field !== undefined), "Provide at least one identity field"),
  z.object({ target: z.literal("memory"), action: z.literal("overwrite"), content: memoryInputSchema, expectedSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ target: z.literal("memory"), action: z.enum(["append", "forget"]), fact: z.string().trim().min(1).max(2000).regex(/^[^\r\n]+$/, "A fact must be a single line") }).strict(),
  z.object({ target: z.literal("settings"), action: z.literal("set"), values: z.record(settingKey, z.json()).refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 100, "Provide 1–100 settings") }).strict(),
  z.object({ target: z.literal("settings"), action: z.literal("unset"), keys: z.array(settingKey).min(1).max(100) }).strict(),
  z.object({ target: z.literal("project"), action: z.enum(["join", "leave", "own", "release"]), projectId: id }).strict(),
]);
export type BotStateMutation = z.infer<typeof stateMutationSchema>;
// Native function-calling providers require an object at the schema root.
// The union above remains the authoritative target/action boundary validator.
export function normalizeStateMutation(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null && field !== undefined));
}
export const stateMutationToolSchema = z.object({
  target: stateTargetSchema, action: z.enum(["set", "overwrite", "append", "forget", "unset", "join", "leave", "own", "release"]),
  expectedRevision: z.number().int().nonnegative().nullish().describe("Required for identity/set. Otherwise omit or null."),
  name: z.string().trim().min(1).max(120).nullish().describe("Identity/set only. Otherwise omit or null."), role: z.string().trim().max(80).nullish().describe("Identity/set only. Otherwise omit or null."),
  soul: z.string().max(4096).nullish().describe("Identity/set only. Otherwise omit or null."),
  content: memoryInputSchema.nullish().describe("Complete replacement memory for memory/overwrite; max 3000 characters. Otherwise omit or null."),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).nullish().describe("Required for memory/overwrite; use sha256 from a fresh memory read. Otherwise omit or null."),
  fact: z.string().trim().min(1).max(2000).nullish().describe("Required for memory append/forget. Otherwise omit or null."),
  values: z.record(settingKey, z.unknown()).nullish().describe("Required for settings/set. Otherwise omit or null."), keys: z.array(settingKey).min(1).max(100).nullish().describe("Required for settings/unset. Otherwise omit or null."), projectId: id.nullish().describe("Required for project join/leave/own/release. Otherwise omit or null."),
}).strict().superRefine((value, ctx) => {
  const result = stateMutationSchema.safeParse(normalizeStateMutation(value));
  if (!result.success) ctx.addIssue({ code: "custom", message: result.error.issues.some((issue) => issue.message.includes("MEMORY.md exceeds")) ? MEMORY_LIMIT_ERROR : "Invalid target/action fields. Use identity/set with expectedRevision and fields; memory/append|forget with fact or memory/overwrite with content (max 3000 characters) and expectedSha256 from bot_read_state; settings/set with values or unset with keys; project/join|leave|own|release with projectId." });
});
export const stateMutationResultSchema = z.object({ botId: id, target: stateTargetSchema, changed: z.boolean(), revision: z.number(), state: z.json() }).strict();

export const rpcContract = defineRpcContract({
  bots_list: { input: z.null(), output: z.object({ bots: z.array(metadataSchema), hosts: z.array(hostSchema), sections: z.array(sectionSchema), projects: z.array(projectSchema), threadBindings: z.array(z.object({ threadId: id, botId: id }).strict()), warnings: z.array(z.string()), personalProjectId: id, projectOwners: z.array(projectOwnerSchema).optional() }).strict() },
  project_browse: { input: projectBrowseInputSchema, output: projectBrowseOutputSchema },
  project_create: { input: projectCreateInputSchema, output: projectSchema },
  bot_create: { input: z.object({ ...editFields, hostId: id }).strict(), output: metadataSchema },
  bot_update: { input: z.object({ ...editFields, hostId: id.optional(), botId: id, expectedUpdatedAt: z.number(), expectedStateHashes: stateHashesSchema }).strict(), output: metadataSchema },
  bot_prepare: { input: z.object({ botId: id }).strict(), output: metadataSchema },
  bots_reorder: { input: z.object({ bots: z.array(z.object({ botId: id, sectionId: id.nullable() }).strict()).max(500) }).strict(), output: z.object({ ok: z.literal(true) }).strict() },
  section_create: { input: z.object({ name: z.string().trim().min(1).max(80) }).strict(), output: sectionSchema },
  section_update: { input: z.object({ sectionId: id, name: z.string().trim().min(1).max(80) }).strict(), output: sectionSchema },
  section_delete: { input: z.object({ sectionId: id }).strict(), output: z.object({ ok: z.literal(true) }).strict() },
  visibility_set: { input: z.object({ botId: id, hiddenUntilActivity: z.boolean() }).strict(), output: metadataSchema },
  main_set: { input: z.object({ botId: id, threadId: id }).strict(), output: metadataSchema },
  conversation_create: { input: z.object({ botId: id, request: newThreadRequestSchema, makeMain: z.boolean().optional() }).strict(), output: z.object({ threadId: id }).strict() },
  conversation_assign: { input: z.object({ botId: id, threadId: id }).strict(), output: z.object({ ok: z.literal(true) }).strict() },
  state_read: { input: z.object({ botId: id, file: stateFileSchema }).strict(), output: stateOutput },
  state_update: { input: stateUpdateSchema.safeExtend({ botId: id }), output: stateOutput },
  state_apply: { input: z.object({ botId: id, change: stateMutationSchema }).strict(), output: stateMutationResultSchema },
});
