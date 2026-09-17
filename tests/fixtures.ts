import type { NewThreadRequest, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { BotMetadata } from "../contract";

export function thread(id: string, updatedAt: number, overrides: Partial<PluginSidebarThread> = {}): PluginSidebarThread {
  return {
    id, projectId: "project", title: `Conversation ${id}`, titleFallback: null, parentThreadId: null, sectionId: null,
    originKind: null, originPluginId: null, providerId: "pi", hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none", indicatorLabel: null, isUnread: false, isPinned: false, isArchived: false,
    environment: { id: "env-existing", name: null, branchName: "feature", workspaceDisplayKind: "managed-worktree", providerId: "pi" },
    host: { id: "host", name: "Local" }, createdAt: 1, updatedAt, lastReadAt: updatedAt, latestAttentionAt: updatedAt,
    ...overrides,
  };
}
export const bot: BotMetadata = {
  id: "bot", name: "Test bot", role: "Assistant", hiddenUntilActivity: false, hiddenAt: null, mainThreadId: "main",
  avatar: { color: "#168b75", shape: "round", expression: "curious", motion: "still" },
  sectionId: null, order: 0, hostId: "host", stateReady: true, legacyHomeProjectId: null, linkedProjectIds: ["project"],
  soul: "", agents: "", memory: "", settings: {}, updatedAt: 1, legacyProjectId: "project",
  stateHashes: { "SOUL.md": null, "AGENTS.md": null, "MEMORY.md": null, "settings.json": null },
};
export const personalProjectId = "personal";
export const personalEnvironment: NewThreadRequest["environment"] = { type: "host", hostId: "host", workspace: { type: "personal" } };
export const request: NewThreadRequest = {
  projectId: "project", providerId: "pi", model: "test-model", reasoningLevel: "high", permissionMode: "accept-edits",
  executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
  environment: { type: "host", hostId: "host", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "main" } } },
  input: [
    { type: "text", text: "Review @Main", mentions: [{ start: 7, end: 12, resource: { kind: "thread", label: "Main", threadId: "main", projectId: "project" } }] },
    { type: "localFile", path: "attachments/spec.md", name: "spec.md", mimeType: "text/markdown", sizeBytes: 200 },
  ],
};
