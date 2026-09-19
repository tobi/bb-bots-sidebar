// @vitest-environment jsdom
import { createElement } from "react";
import type { NewThreadComposerProps } from "@get-bb/plugin-sdk/app";
import { rpcContract, type BotMetadata } from "../contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { bot, personalProjectId, request, thread } from "./fixtures";
import { conversationDraftKey, worktreeLaunchEnvironment } from "../lib/worktree-launch";

const composer = vi.hoisted(() => ({ props: null as NewThreadComposerProps | null }));
function composerProps(): NewThreadComposerProps {
  const props = composer.props;
  if (!props) throw new Error("composer not mounted");
  return props;
}
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  return { ...sdk, experimental_NewThreadComposer: (props: NewThreadComposerProps) => {
    composer.props = props;
    return createElement(sdk.experimental_NewThreadComposer, props);
  } };
});
const app = await loadPluginApp(() => import("../app"));
afterEach(async () => {
  cleanup(); composer.props = null;
  // Radix defers focus restoration; drain it before JSDOM's Event realm closes.
  await new Promise(resolve => setTimeout(resolve, 0));
});

const fresh = (hostId: string) => worktreeLaunchEnvironment(hostId);

async function mount({
  bots = [bot],
  rows = [thread("main", 100)],
  bindings = [{ botId: bot.id, threadId: "main" }, { botId: bot.id, threadId: "0" }],
}: { bots?: BotMetadata[]; rows?: ReturnType<typeof thread>[]; bindings?: Array<{ botId: string; threadId: string }> } = {}) {
  const slot = renderSlot(app.threadLists[0]!, {
    activeThreadId: "main", activeProjectId: "project", isCompactViewport: false, onNavigate: vi.fn(), searchQuery: "", Original: () => null,
  }, {
    sidebarThreads: { projects: [
      { id: "project", name: "Shared project", isPersonal: false },
      { id: "second", name: "Second project", isPersonal: false },
      { id: "unrelated", name: "Brand new unrelated project", isPersonal: false },
    ], threads: rows },
    rpc: {
      bots_list: async () => rpcContract.bots_list.output.parse({
        bots: [...bots],
        hosts: [{ id: "host", name: "Local", connected: true }, { id: "remote", name: "Remote", connected: true }, { id: "main-host", name: "Main", connected: true }],
        sections: [], projects: [{ id: "project", name: "Shared project" }, { id: "second", name: "Second project" }, { id: "unrelated", name: "Brand new unrelated project" }],
        threadBindings: [...bindings], warnings: [], personalProjectId, projectOwners: [],
      }),
      bot_prepare: (raw) => {
        const { botId } = rpcContract.bot_prepare.input.parse(raw);
        return rpcContract.bot_prepare.output.parse(bots.find((entry) => entry.id === botId) ?? bot);
      },
      conversation_create: () => rpcContract.conversation_create.output.parse({ threadId: "created-conversation" }),
    },
  });
  await waitFor(() => expect(slot.queryByText("Loading bots…")).toBeNull());
  for (const toggle of slot.queryAllByRole("button", { name: /^Expand conversations for / })) fireEvent.click(toggle);
  return slot;
}

describe("new conversation in worktree", () => {
  it.each(["project", "worktree"])("opens %s directly in the main conversation's linked work project", async (kind) => {
    const slot = await mount({
      bots: [{ ...bot, linkedProjectIds: ["project", "second"] }],
      rows: [thread("main", 100, { projectId: "second", host: { id: "remote", name: "Remote" } })],
    });
    fireEvent.contextMenu(slot.getByText("Test bot"));
    fireEvent.click(await slot.findByRole("menuitem", { name: `New conversation in ${kind}…` }));
    await slot.findByRole("dialog", { name: `New conversation in ${kind}` });
    expect(slot.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(composerProps().defaultProjectId).toBe("second");
    expect(composerProps().defaultEnvironment).toEqual(kind === "worktree" ? fresh("remote") : { type: "host", hostId: "remote", workspace: { type: "unmanaged", path: null } });
    const seeded = composerProps().defaultEnvironment;
    await slot.behavior.emitRealtime("project-bots-changed", {});
    expect(composerProps().defaultEnvironment).toEqual(seeded);
    expect(composerProps().defaultProjectId).toBe("second");
    expect(slot.inspection.rpcCalls.some(call => call.method === "conversation_create")).toBe(false);
  });

  it("seeds a fresh worktree on the clicked conversation machine and never reuses its environment", async () => {
    const slot = await mount({
      rows: [thread("main", 100), thread("0", 90, { host: { id: "remote", name: "Remote" }, environment: { id: "env-existing", name: null, branchName: "feature", providerId: null, workspaceDisplayKind: "managed-worktree" } })],
    });
    fireEvent.contextMenu(slot.getByText("Conversation 0"));
    fireEvent.click(await slot.findByRole("menuitem", { name: "New conversation in worktree…" }));
    const dialog = await slot.findByRole("dialog", { name: "New conversation in worktree" });
    expect(dialog.textContent).toContain("Start in a fresh worktree. Choose the branch and harness before sending.");
    expect(composerProps().defaultProjectId).toBe("project");
    expect(composerProps().defaultEnvironment).toEqual(fresh("remote"));
    expect(composerProps().draftKey).toBe(conversationDraftKey({ botId: bot.id, kind: "worktree", makeMain: false, projectId: "project", environment: fresh("remote") }));
    expect(JSON.stringify(composerProps().defaultEnvironment)).not.toContain("reuse");
    expect(JSON.stringify(composerProps().defaultEnvironment)).not.toContain("env-existing");
  });

  it("seeds the bot action from the main conversation machine, then the bot host", async () => {
    const slot = await mount({
      bots: [{ ...bot, hostId: "host" }],
      rows: [thread("main", 100, { host: { id: "main-host", name: "Main" } })],
      bindings: [{ botId: bot.id, threadId: "main" }],
    });
    fireEvent.contextMenu(slot.getByText("Test bot"));
    fireEvent.click(await slot.findByRole("menuitem", { name: "New conversation in worktree…" }));
    await slot.findByRole("dialog", { name: "New conversation in worktree" });
    expect(slot.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(composerProps().defaultEnvironment).toEqual(fresh("main-host"));

    cleanup(); composer.props = null;
    const fallback = await mount({
      bots: [{ ...bot, hostId: "host", mainThreadId: null }],
      rows: [],
      bindings: [],
    });
    fireEvent.contextMenu(fallback.getByText("Test bot"));
    fireEvent.click(await fallback.findByRole("menuitem", { name: "New conversation in worktree…" }));
    await fallback.findByRole("dialog", { name: "New conversation in worktree" });
    expect(fallback.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(composerProps().defaultEnvironment).toEqual(fresh("host"));
  });

  it("opens the composer directly from a personal/legacy row using a valid work project and the row's machine", async () => {
    const slot = await mount({
      bots: [{ ...bot, legacyHomeProjectId: "legacy-project" }],
      rows: [thread("main", 100), thread("personal-topic", 99, { projectId: personalProjectId, host: { id: "origin-host", name: "Origin" } })],
      bindings: [{ botId: bot.id, threadId: "main" }, { botId: bot.id, threadId: "personal-topic" }],
    });
    fireEvent.contextMenu(slot.getByText("Conversation personal-topic"));
    fireEvent.click(await slot.findByRole("menuitem", { name: "New conversation in worktree…" }));
    const dialog = await slot.findByRole("dialog", { name: "New conversation in worktree" });
    expect(dialog.querySelector("select")).toBeNull();
    expect(slot.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(composerProps().defaultProjectId).toBe("project");
    expect(composerProps().defaultEnvironment).toEqual(fresh("origin-host"));
  });

  it("forwards the user's composer override and keeps projectless chat drafts on :new", async () => {
    const slot = await mount({
      rows: [thread("main", 100), thread("0", 90, { host: { id: "remote", name: "Remote" } })],
    });
    fireEvent.contextMenu(slot.getByText("Conversation 0"));
    fireEvent.click(await slot.findByRole("menuitem", { name: "New conversation in worktree…" }));
    await slot.findByRole("dialog", { name: "New conversation in worktree" });
    const chosen = { ...request, projectId: "second", environment: { type: "host" as const, hostId: "other", workspace: { type: "unmanaged" as const, path: null } } };
    await act(() => composerProps().onSubmit(chosen));
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_create", input: { botId: bot.id, request: chosen, makeMain: false } });

    cleanup(); composer.props = null;
    const chat = await mount();
    fireEvent.contextMenu(chat.getByText("Test bot"));
    fireEvent.click(await chat.findByRole("menuitem", { name: "New conversation…" }));
    await chat.findByRole("dialog", { name: "New conversation" });
    expect(composerProps().defaultEnvironment).toEqual({ type: "host", hostId: "host", workspace: { type: "personal" } });
    expect(composerProps().draftKey).toBe("bots:bot:bot:personal:new");
  });
});
