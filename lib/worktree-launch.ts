import type { NewThreadRequest, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { BotMetadata, ProjectOwner } from "../contract";

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

// A generic new chat follows ownership, not membership or whichever project
// happens to be active. Multiple owned projects use main context, then link order.
export function ownedConversationProjectId({ bot, projects, owners, personalProjectId, main }: {
  bot: Pick<BotMetadata, "id" | "linkedProjectIds" | "legacyHomeProjectId">;
  projects: ReadonlyArray<{ id: string }>;
  owners: readonly ProjectOwner[];
  personalProjectId: string | null;
  main?: Pick<PluginSidebarThread, "projectId"> | null;
}): string | null {
  const available = new Set(projects.filter(project => project.id !== personalProjectId && project.id !== bot.legacyHomeProjectId).map(project => project.id));
  const owned = new Set(owners.filter(owner => owner.botId === bot.id && available.has(owner.projectId)).map(owner => owner.projectId));
  if (main && owned.has(main.projectId)) return main.projectId;
  return bot.linkedProjectIds.find(id => owned.has(id)) ?? projects.find(project => owned.has(project.id))?.id ?? null;
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
