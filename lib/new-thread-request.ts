import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

// Validate the public composer request at the RPC boundary. Keep provenance,
// mentions and attachments intact; the SDK owns execution/environment policy.
const id = z.string().min(1);
const resource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("thread"), label: z.string(), threadId: id, projectId: id.optional() }).strict(),
  z.object({ kind: z.literal("project"), label: z.string(), projectId: id }).strict(),
  z.object({ kind: z.literal("section"), label: z.string(), sectionId: id }).strict(),
  z.object({ kind: z.literal("path"), label: z.string(), path: z.string(), entryKind: z.enum(["file", "directory"]), source: z.enum(["workspace", "thread-storage"]) }).strict(),
  z.object({ kind: z.literal("command"), label: z.string(), name: z.string(), argumentHint: z.string().nullable(), origin: z.enum(["builtin", "project", "user"]), source: z.enum(["command", "skill"]), trigger: z.literal("/") }).strict(),
  z.object({ kind: z.literal("plugin"), label: z.string(), pluginId: id, itemId: id, icon: z.string().nullable().optional() }).strict(),
]);
const visibility = z.literal("agent-only").optional();
const input = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string(), mentions: z.array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), resource }).strict()), visibility }).strict(),
  z.object({ type: z.literal("image"), url: z.string(), visibility }).strict(),
  z.object({ type: z.literal("localImage"), path: z.string(), visibility }).strict(),
  z.object({ type: z.literal("localFile"), path: z.string(), mimeType: z.string().optional(), name: z.string().optional(), sizeBytes: z.number().nonnegative().optional(), visibility }).strict(),
]);
const environment = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reuse"), environmentId: id }).strict(),
  z.object({ type: z.literal("project-default") }).strict(),
  z.object({ type: z.literal("provider") }).passthrough(),
  z.object({
    type: z.literal("host"), hostId: id.optional(),
    workspace: z.discriminatedUnion("type", [
      z.object({ type: z.literal("personal") }).strict(),
      z.object({ type: z.literal("unmanaged"), path: z.string().nullable(), branch: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("existing"), name: id }).strict(),
        z.object({ kind: z.literal("new"), baseBranch: id }).strict(),
      ]).optional() }).strict(),
      z.object({ type: z.literal("managed-worktree"), baseBranch: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("default") }).strict(),
        z.object({ kind: z.literal("named"), name: id }).strict(),
      ]) }).strict(),
    ]),
  }).strict(),
]);
const source = z.enum(["explicit", "client-preference"]).optional();
export const newThreadRequestSchema: z.ZodType<NewThreadRequest> = z.object({
  projectId: id, providerId: id, model: z.string(),
  reasoningLevel: z.enum(["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"]),
  permissionMode: z.enum(["accept-edits", "auto", "full"]),
  serviceTier: z.enum(["default", "fast"]).optional(),
  executionInputSources: z.object({ providerId: source, model: source, reasoningLevel: source, permissionMode: source, serviceTier: source }).strict(),
  environment, input: z.array(input).min(1), sendAt: z.number().int().nonnegative().optional(),
}).strict();
