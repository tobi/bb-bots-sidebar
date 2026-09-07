import type { NewThreadRequest, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { BotMetadata } from "../contract";

// Host NewThreadComposer only seeds the environment picker when hostId is set
// (`newThreadEnvironmentArgsToSeed` returns null otherwise). This action always
// creates a fresh managed worktree; never reuse an existing environment.

export function worktreeLaunchHostId(
  bot: BotMetadata,
  origin?: PluginSidebarThread | null,
  main?: PluginSidebarThread | null,
): string {
  return origin?.host?.id ?? main?.host?.id ?? bot.hostId;
}

export function worktreeLaunchEnvironment(hostId: string): Extract<NewThreadRequest["environment"], { type: "host" }> {
  return { type: "host", hostId, workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } };
}

export function projectLaunchEnvironment(hostId: string): Extract<NewThreadRequest["environment"], { type: "host" }> {
  return { type: "host", hostId, workspace: { type: "unmanaged", path: null } };
}

// Pick an initial work context; the native popup already has its own project
// picker. The caller supplies linked projects first, never personal/legacy homes.
export function conversationLaunchProjectId(
  workProjects: ReadonlyArray<{ id: string }>,
  origin?: PluginSidebarThread | null,
  preferredMain?: PluginSidebarThread | null,
): string | null {
  for (const context of [origin, preferredMain]) {
    if (context && workProjects.some((project) => project.id === context.projectId)) return context.projectId;
  }
  return workProjects[0]?.id ?? null;
}

export function conversationDraftKey(input: {
  botId: string;
  kind: "bot" | "project" | "worktree";
  makeMain: boolean;
  projectId: string;
  environment: NewThreadRequest["environment"];
}): string {
  const scope = input.makeMain ? "main" : input.kind;
  const environment = input.environment.type === "reuse"
    ? input.environment.environmentId
    : input.kind === "worktree" && input.environment.type === "host"
      ? `worktree:${input.environment.hostId ?? "unspecified"}`
      : "new";
  // This is a stable draft key, not the runtime plugin ID. Preserve old drafts.
  return `bots:${input.botId}:${scope}:${input.projectId}:${environment}`;
}
