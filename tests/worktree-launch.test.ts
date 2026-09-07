import { describe, expect, it } from "vitest";
import { bot, personalProjectId, thread } from "./fixtures";
import {
  conversationDraftKey,
  worktreeLaunchEnvironment,
  worktreeLaunchHostId,
  conversationLaunchProjectId,
  projectLaunchEnvironment,
} from "../lib/worktree-launch";

const workProjects = [{ id: "project" }, { id: "second" }, { id: "unrelated" }];
const remote = thread("topic", 10, { host: { id: "remote", name: "Remote" } });
const mainRemote = thread("main", 100, { host: { id: "main-host", name: "Main" } });
const personal = thread("personal-topic", 9, { projectId: personalProjectId, host: { id: "origin-host", name: "Origin" } });

describe("worktree launch", () => {
  it("prefers the clicked conversation machine over main and bot hosts", () => {
    expect(worktreeLaunchHostId(bot, remote, mainRemote)).toBe("remote");
  });

  it("uses the main conversation machine, then the bot host, when there is no row", () => {
    expect(worktreeLaunchHostId(bot, undefined, mainRemote)).toBe("main-host");
    expect(worktreeLaunchHostId({ ...bot, hostId: "bot-host" }, undefined, thread("main", 1, { host: null }))).toBe("bot-host");
    expect(worktreeLaunchHostId({ ...bot, hostId: "bot-host" })).toBe("bot-host");
  });

  it("never encodes reuse; always a fresh managed-worktree on the chosen host", () => {
    expect(worktreeLaunchEnvironment("remote")).toEqual({
      type: "host", hostId: "remote",
      workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
    });
    expect(JSON.stringify(worktreeLaunchEnvironment("remote"))).not.toContain("reuse");
  });

  it("seeds a valid project immediately, preferring row/main context over linked-first fallback", () => {
    expect(conversationLaunchProjectId(workProjects, remote)).toBe("project");
    expect(conversationLaunchProjectId(workProjects, personal)).toBe("project");
    expect(conversationLaunchProjectId(workProjects)).toBe("project");
    expect(conversationLaunchProjectId(workProjects, undefined, thread("main", 1, { projectId: "second" }))).toBe("second");
    expect(conversationLaunchProjectId(workProjects, remote, thread("main", 1, { projectId: "second" }))).toBe("project");
    expect(conversationLaunchProjectId([], personal)).toBeNull();
  });

  it("seeds project conversations into the host checkout, not an implicit remembered worktree", () => {
    expect(projectLaunchEnvironment("remote")).toEqual({ type: "host", hostId: "remote", workspace: { type: "unmanaged", path: null } });
  });

  it("scopes worktree drafts by host so a prior workspace choice cannot win", () => {
    const environment = worktreeLaunchEnvironment("remote");
    expect(conversationDraftKey({ botId: bot.id, kind: "worktree", makeMain: false, projectId: "project", environment }))
      .toBe("bots:bot:worktree:project:worktree:remote");
    expect(conversationDraftKey({ botId: bot.id, kind: "worktree", makeMain: false, projectId: "project", environment: worktreeLaunchEnvironment("host") }))
      .not.toBe(conversationDraftKey({ botId: bot.id, kind: "worktree", makeMain: false, projectId: "project", environment }));
    expect(conversationDraftKey({ botId: bot.id, kind: "bot", makeMain: false, projectId: personalProjectId, environment: { type: "host", hostId: "host", workspace: { type: "personal" } } }))
      .toBe("bots:bot:bot:personal:new");
  });
});
