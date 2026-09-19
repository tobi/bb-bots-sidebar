// @vitest-environment jsdom
import { createElement } from "react";
import type { NewThreadComposerProps } from "@get-bb/plugin-sdk/app";
import { rpcContract, type BotMetadata } from "../contract";
import { selectOption } from "./select-helper";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { bot, personalEnvironment, personalProjectId, request, thread } from "./fixtures";

const personalRequest = { ...request, projectId: personalProjectId, environment: personalEnvironment };

// Keep the SDK's host-composer test component. Capture its public boundary so
// tests can also submit the choices a real host composer lets the user change.
const composer = vi.hoisted(() => ({ props: null as NewThreadComposerProps | null }));
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
  await new Promise(resolve => setTimeout(resolve, 0));
});

type Binding = { botId: string; threadId: string };
async function mount({
  bots = [bot], rows = [thread("main", 100)], bindings = [{ botId: bot.id, threadId: "main" }], activeThreadId = "main", warnings = [], prepareFailures = 0, preparedMainThreadId, projectOwners = [], beforeList,
}: { bots?: BotMetadata[]; rows?: ReturnType<typeof thread>[]; bindings?: Binding[]; activeThreadId?: string | null; warnings?: string[]; prepareFailures?: number; preparedMainThreadId?: string; projectOwners?: Array<{ projectId: string; botId: string }>; beforeList?: () => Promise<void> } = {}) {
  const onNavigate = vi.fn();
  const slot = renderSlot(app.threadLists[0]!, {
    activeThreadId, activeProjectId: "project", isCompactViewport: false, onNavigate, searchQuery: "", Original: () => null,
  }, {
    sidebarThreads: { projects: [
      { id: "project", name: "Shared project", isPersonal: false },
      { id: "second", name: "Second project", isPersonal: false },
      { id: "unrelated", name: "Brand new unrelated project", isPersonal: false },
      { id: "legacy-project", name: "Legacy backing project", isPersonal: false },
    ], threads: rows },
    rpc: {
      bots_list: async () => { await beforeList?.(); return rpcContract.bots_list.output.parse({ bots: [...bots], hosts: [{ id: "host", name: "Local", connected: true }, { id: "remote", name: "Remote", connected: true }], sections: [], projects: [{ id: "project", name: "Shared project" }, { id: "second", name: "Second project" }, { id: "unrelated", name: "Brand new unrelated project" }], threadBindings: [...bindings], warnings, personalProjectId, projectOwners }); },
      bot_prepare: (raw) => {
        const { botId } = rpcContract.bot_prepare.input.parse(raw);
        if (prepareFailures-- > 0) throw new Error("Private state temporarily unavailable");
        const index = bots.findIndex((bot) => bot.id === botId);
        bots[index] = { ...bots[index]!, stateReady: true, ...(preparedMainThreadId ? { mainThreadId: preparedMainThreadId } : {}) };
        return rpcContract.bot_prepare.output.parse(bots[index]);
      },
      bot_update: (raw) => {
        const input = rpcContract.bot_update.input.parse(raw);
        const index = bots.findIndex((bot) => bot.id === input.botId);
        bots[index] = { ...bots[index]!, name: input.name!, linkedProjectIds: input.linkedProjectIds!, soul: input.soul!! };
        return bots[index];
      },
      bot_create: (raw) => {
        const input = rpcContract.bot_create.input.parse(raw);
        const created = rpcContract.bot_create.output.parse({ ...bot, name: input.name, role: input.role, avatar: input.avatar, sectionId: input.sectionId, linkedProjectIds: input.linkedProjectIds, soul: input.soul, hostId: input.hostId, id: "created", mainThreadId: null, stateReady: true, legacyHomeProjectId: null });
        bots.push(created); return created;
      },
      conversation_assign: (raw) => { bindings.push(rpcContract.conversation_assign.input.parse(raw)); return { ok: true }; },
      conversation_create: (raw) => {
        const input = rpcContract.conversation_create.input.parse(raw);
        if (input.makeMain) {
          const index = bots.findIndex((bot) => bot.id === input.botId);
          bots[index] = { ...bots[index]!, mainThreadId: "created-conversation" };
        }
        bindings.push({ botId: input.botId, threadId: "created-conversation" });
        return { threadId: "created-conversation" };
      },
      visibility_set: () => bot,
    },
  });
  await waitFor(() => expect(slot.queryByText("Loading bots…")).toBeNull());
  for (const toggle of slot.queryAllByRole("button", { name: /^Expand conversations for / })) fireEvent.click(toggle);
  return { slot, onNavigate };
}

async function menu(slot: Awaited<ReturnType<typeof mount>>["slot"], botName: string, item: string) {
  fireEvent.contextMenu(slot.getByText(botName));
  fireEvent.click(await slot.findByRole("menuitem", { name: item }));
}

async function createFromMenu(slot: Awaited<ReturnType<typeof mount>>["slot"], kind: "Bot" | "Section" | "Project") {
  fireEvent.keyDown(slot.getByRole("button", { name: "Create…" }), { key: "ArrowDown" });
  fireEvent.click(await slot.findByRole("menuitem", { name: kind }));
}
function linkProject(dialog: HTMLElement, name: string) {
  fireEvent.click(within(dialog).getByRole("button", { name: "Add existing…" }));
  fireEvent.click(within(dialog).getByRole("button", { name: `Link ${name}` }));
}

describe("independent bot identities", () => {
  it("keeps two bots sharing one project separate and leaves unassigned project chats in Chats", async () => {
    const second = { ...bot, id: "second-bot", name: "Second bot", mainThreadId: "second-main" };
    const { slot } = await mount({ bots: [bot, second], rows: [
      thread("main", 100), thread("first-root", 99), thread("first-child", 98, { parentThreadId: "first-root" }),
      thread("second-main", 97), thread("second-root", 96),
      thread("explicit-override", 95, { parentThreadId: "first-root" }),
      thread("unassigned-project", 94), thread("unassigned-unrelated", 93, { projectId: "unrelated" }),
    ], bindings: [
      { botId: bot.id, threadId: "main" }, { botId: bot.id, threadId: "first-root" },
      { botId: second.id, threadId: "second-main" }, { botId: second.id, threadId: "second-root" }, { botId: second.id, threadId: "explicit-override" },
    ], activeThreadId: "first-child" });
    const firstGroup = slot.getByText(bot.name).closest<HTMLElement>(".project-group")!;
    const secondGroup = slot.getByText(second.name).closest<HTMLElement>(".project-group")!;
    expect(within(firstGroup).getByText("Conversation first-child")).toBeTruthy();
    expect(within(firstGroup).queryByText("Conversation second-root")).toBeNull();
    expect(within(firstGroup).queryByText("Conversation explicit-override")).toBeNull();
    expect(slot.queryByText("Brand new unrelated project")).toBeNull();
    expect(slot.queryByText("Legacy backing project")).toBeNull();
    expect(secondGroup.querySelector('[aria-current="page"]')).toBeNull();
    // Both bot lists were explicitly expanded in the fixture.
    expect(within(secondGroup).getByText("Conversation second-root")).toBeTruthy();
    expect(within(secondGroup).getByText("Conversation explicit-override")).toBeTruthy();
    expect(within(secondGroup).queryByText("Conversation first-root")).toBeNull();
    for (const id of ["unassigned-project", "unassigned-unrelated"]) {
      expect(slot.container.querySelector(`[data-sidebar-thread-id="${id}"]`)?.closest(".recent-row")).not.toBeNull();
    }
    expect(slot.container.querySelector('.recent-row [data-sidebar-thread-id="first-root"]')).toBeNull();
    expect(slot.inspection.rpcCalls.some((call) => call.method === "main_set")).toBe(false);
  });

  it("prepares private state for a bot with no project or main and seeds the projectless composer", async () => {
    const newBot = { ...bot, id: "solo", name: "Solo bot", linkedProjectIds: [], mainThreadId: null, stateReady: false };
    const { slot } = await mount({ bots: [newBot], rows: [thread("unassigned", 100)], bindings: [], activeThreadId: "unassigned" });
    expect(slot.getByText("Solo bot")).toBeTruthy();
    expect(slot.queryByRole("button", { name: /hidden/ })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: /^Solo bot/ }));
    await slot.findByRole("dialog", { name: "New conversation" });
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "bot_prepare", input: { botId: "solo" } });
    expect(composer.props?.defaultProjectId).toBe(personalProjectId);
    expect(composer.props?.defaultEnvironment).toEqual(personalEnvironment);
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
    // The personal project comes from bots_list, not the sidebar project cache.
    expect(slot.inspection.rpcCalls.map((call) => call.method)).toEqual(["bots_list", "bot_prepare", "bots_list"]);
    await act(() => composer.props!.onSubmit(personalRequest));
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_create", input: { botId: "solo", makeMain: false, request: personalRequest } });
    expect(slot.inspection.rpcCalls.some((call) => call.method === "main_set")).toBe(false);
  });

  it.each(["missing", "archived"])("offers a new projectless main for a %s main without replacing it before send", async (kind) => {
    const { slot } = await mount({ rows: kind === "missing" ? [] : [thread("main", 100, { isArchived: true })], activeThreadId: null });
    fireEvent.click(slot.getByRole("button", { name: /^Test bot/ }));
    await slot.findByRole("dialog", { name: "New conversation" });
    expect(composer.props?.defaultProjectId).toBe(personalProjectId);
    expect(composer.props?.defaultEnvironment).toEqual(personalEnvironment);
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
    expect(slot.inspection.navigateCalls).toEqual([]);
    expect(slot.inspection.rpcCalls.some((call) => call.method === "main_set" || call.method === "conversation_create")).toBe(false);
    await act(() => composer.props!.onSubmit(personalRequest));
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_create", input: { botId: bot.id, request: personalRequest, makeMain: false } });
  });

  it("opens a visible unarchived main through the host sidebar action", async () => {
    const { slot } = await mount();
    fireEvent.click(slot.getByRole("button", { name: /^Test bot/ }));
    expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "open", threadId: "main" });
    expect(slot.inspection.rpcCalls.some((call) => call.method === "bot_prepare")).toBe(false);
  });

  it("does not navigate to a stale special main outside the visible list", async () => {
    const { slot } = await mount({ bots: [{ ...bot, mainThreadId: null, stateReady: false }], rows: [], bindings: [], preparedMainThreadId: "concurrent-main" });
    fireEvent.click(slot.getByRole("button", { name: /^Test bot/ }));
    await slot.findByRole("dialog", { name: "New conversation" });
    expect(slot.inspection.navigateCalls).toEqual([]);
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
    expect(slot.getByRole("dialog", { name: "New conversation" })).toBeTruthy();
    expect(slot.inspection.rpcCalls.some((call) => call.method === "main_set" || call.method === "conversation_create")).toBe(false);
  });

  it("starts an ordinary conversation and preserves all composer execution/input choices", async () => {
    const { slot, onNavigate } = await mount();
    await menu(slot, bot.name, "New conversation…");
    await slot.findByRole("dialog", { name: "New conversation" });
    expect(slot.inspection.rpcCalls.some((call) => call.method === "main_set" || call.method === "conversation_create")).toBe(false);
    expect(composer.props?.defaultProjectId).toBe(personalProjectId);
    expect(composer.props?.defaultEnvironment).toEqual(personalEnvironment);
    const chosen = { ...request, serviceTier: "fast" as const, sendAt: 1234567890 };
    await act(() => composer.props!.onSubmit(chosen));
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_create", input: { botId: bot.id, request: chosen, makeMain: false } });
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "created-conversation" });
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(slot.inspection.rpcCalls.some((call) => call.method === "main_set")).toBe(false);
    await waitFor(() => expect(slot.container.querySelector('.thread-row [data-sidebar-thread-id="main"]')).not.toBeNull());
  });

  it("defaults a normal bot chat to the personal workspace on its execution machine without replacing main", async () => {
    const { slot } = await mount({ bots: [{ ...bot, hostId: "remote" }] });
    await menu(slot, bot.name, "New conversation…");
    await slot.findByRole("dialog", { name: "New conversation" });
    expect(composer.props?.defaultProjectId).toBe(personalProjectId);
    expect(composer.props?.defaultEnvironment).toEqual({ type: "host", hostId: "remote", workspace: { type: "personal" } });
    // The user can choose a different host in BB's composer; forward it as-is.
    await act(() => composer.props!.onSubmit(personalRequest));
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_create", input: { botId: bot.id, request: personalRequest, makeMain: false } });
  });

  it.each(["project", "worktree"] as const)("opens the %s composer immediately with matching workspace defaults", async (kind) => {
    const { slot } = await mount({ bots: [{ ...bot, linkedProjectIds: ["project", "second"] }] });
    await menu(slot, bot.name, `New conversation in ${kind}…`);
    await slot.findByRole("dialog", { name: `New conversation in ${kind}` });
    expect(slot.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(composer.props?.defaultProjectId).toBe("project");
    expect(composer.props?.defaultEnvironment).toEqual(kind === "project" ? { type: "host", hostId: "host", workspace: { type: "unmanaged", path: null } } : { type: "host", hostId: "host", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } });
    expect(composer.props?.defaultProviderId).toBeUndefined();
    await act(() => composer.props!.onSubmit({ ...request, projectId: "second" }));
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_create", input: { botId: bot.id, request: { ...request, projectId: "second" }, makeMain: false } });
  });

  it("lets the generic composer explicitly launch in any available work project without prior membership", async () => {
    const { slot } = await mount({ bots: [{ ...bot, linkedProjectIds: [] }] });
    await menu(slot, bot.name, "New conversation…");
    await slot.findByRole("dialog", { name: "New conversation" });
    await act(() => composer.props!.onSubmit({ ...request, projectId: "unrelated" }));
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_create", input: { botId: bot.id, request: { ...request, projectId: "unrelated" }, makeMain: false } });
  });

  it("seeds the first linked project while allowing another project in the native composer", async () => {
    const { slot } = await mount({ bots: [{ ...bot, linkedProjectIds: ["unrelated"] }] });
    await menu(slot, bot.name, "New conversation in project…");
    await slot.findByRole("dialog", { name: "New conversation in project" });
    expect(slot.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(composer.props?.defaultProjectId).toBe("unrelated");
    await act(() => composer.props!.onSubmit({ ...request, projectId: "second" }));
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_create", input: { botId: bot.id, request: { ...request, projectId: "second" }, makeMain: false } });
  });

  it("edits independent name, SOUL, and multiple project links without renaming any project", async () => {
    const { slot } = await mount();
    await menu(slot, bot.name, "Add / manage projects…");
    const dialog = await slot.findByRole("dialog", { name: "Edit bot" });
    expect(within(dialog).getByRole("tab", { name: /^Projects/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Setup" }));
    expect(within(dialog).queryByRole("textbox", { name: "Home folder" })).toBeNull();
    expect(within(dialog).getByText(/State is stored privately in BB/)).toBeTruthy();
    expect(dialog.querySelector(".bot-home-path")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Use custom" })).toBeNull();
    selectOption(within(dialog).getByRole("combobox", { name: "Machine" }), "Remote");
    fireEvent.click(within(dialog).getByRole("tab", { name: /^Projects/ }));
    expect((within(dialog).getByRole("combobox", { name: "Shared project role" }) as HTMLSelectElement).value).toBe("member");
    expect(within(dialog).queryByRole("combobox", { name: "Legacy backing project role" })).toBeNull();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Bot name" }), { target: { value: "Renamed bot" } });
    fireEvent.click(within(dialog).getByRole("tab", { name: "Instructions" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "SOUL.md" }), { target: { value: "Work carefully\nKeep history" } });
    fireEvent.click(within(dialog).getByRole("tab", { name: /^Projects/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink Shared project" }));
    linkProject(dialog, "Second project");
    linkProject(dialog, "Brand new unrelated project");
    expect(slot.inspection.rpcCalls.some((call) => call.method === "bot_update")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save bot" }));
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "bot_update", input: expect.objectContaining({ botId: bot.id, hostId: "remote", name: "Renamed bot", soul: "Work carefully\nKeep history", linkedProjectIds: ["second", "unrelated"], ownedProjectIds: [], expectedUpdatedAt: bot.updatedAt, expectedStateHashes: bot.stateHashes }) });
    expect(slot.getByText("Renamed bot")).toBeTruthy();
    expect(slot.inspection.rpcCalls.some((call) => call.method === "project_update")).toBe(false);
  });

  it("creates with private state and Main/Create New section choices, never a home or custom path control", async () => {
    const { slot } = await mount({ bots: [], bindings: [] });
    await createFromMenu(slot, "Bot");
    const dialog = await slot.findByRole("dialog", { name: "Create bot" });
    const section = within(dialog).getByRole("combobox", { name: "Section" }) as HTMLSelectElement;
    expect(section.value).toBe("");
    expect(section.selectedOptions[0]?.textContent).toBe("Main");
    expect(within(dialog).getByRole("option", { name: "Create New…" })).toBeTruthy();
    expect(within(dialog).queryByRole("textbox", { name: "Home folder" })).toBeNull();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Bot name" }), { target: { value: "Research Buddy" } });
    expect(within(dialog).getByText(/State is stored privately in BB/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /Use custom|Use automatic/ })).toBeNull();
    expect(dialog.textContent).not.toMatch(/~\/bots|Home folder|Working directory/);
    for (const label of ["Instructions", /^Projects/, "Appearance", "Setup"]) {
      fireEvent.click(within(dialog).getByRole("tab", { name: label }));
      expect(within(dialog).queryByRole("textbox", { name: /folder|path|directory/i })).toBeNull();
    }
    fireEvent.click(within(dialog).getByRole("button", { name: "Create bot" }));
    await waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "bot_create")).toBe(true));
    expect(slot.inspection.rpcCalls.find((call) => call.method === "bot_create")?.input).not.toHaveProperty("homePath");
  });

  it("creates a standalone bot with private state and uses the selected machine only for execution", async () => {
    const { slot } = await mount({ bots: [], bindings: [] });
    await createFromMenu(slot, "Bot");
    const dialog = await slot.findByRole("dialog", { name: "Create bot" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Bot name" }), { target: { value: "New identity" } });
    selectOption(within(dialog).getByRole("combobox", { name: "Machine" }), "Remote");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create bot" }));
    await slot.findByRole("dialog", { name: "New conversation" });
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "bot_create", input: expect.objectContaining({ name: "New identity", hostId: "remote", linkedProjectIds: [], ownedProjectIds: [], soul: "" }) });
    expect(slot.inspection.rpcCalls.find((call) => call.method === "bot_create")?.input).not.toHaveProperty("homePath");
    expect(slot.getByText("New identity")).toBeTruthy();
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "bot_prepare", input: { botId: "created" } });
    expect(composer.props?.defaultProjectId).toBe(personalProjectId);
    expect(composer.props?.defaultEnvironment).toEqual({ type: "host", hostId: "remote", workspace: { type: "personal" } });
    expect(slot.inspection.rpcCalls.every((call) => ["bots_list", "bot_create", "bot_prepare"].includes(call.method))).toBe(true);
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
  });

  it("retries private state preparation after creation without creating another identity", async () => {
    const { slot } = await mount({ bots: [], bindings: [], prepareFailures: 1 });
    await createFromMenu(slot, "Bot");
    const dialog = await slot.findByRole("dialog", { name: "Create bot" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Bot name" }), { target: { value: "Retry bot" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create bot" }));
    await slot.findByText("Private state temporarily unavailable");
    expect(slot.queryByRole("dialog")).toBeNull();
    expect(slot.getByText("Retry bot")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: /^Retry bot/ }));
    await slot.findByRole("dialog", { name: "New conversation" });
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "bot_create")).toHaveLength(1);
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "bot_prepare")).toEqual([
      { method: "bot_prepare", input: { botId: "created" } }, { method: "bot_prepare", input: { botId: "created" } },
    ]);
    expect(slot.queryByRole("alert")).toBeNull();
  });

  it("offers all bots instead of filtering assignment by project membership", async () => {
    const { slot } = await mount({ bots: [bot, { ...bot, id: "unlinked", name: "Unlinked bot", linkedProjectIds: [] }, { ...bot, id: "legacy-owner", name: "Legacy owner", legacyHomeProjectId: "project", linkedProjectIds: [] }], rows: [thread("unassigned", 99)], bindings: [] });
    fireEvent.contextMenu(slot.getByText("Conversation unassigned"));
    fireEvent.click(await slot.findByRole("menuitem", { name: "Assign to bot…" }));
    const dialog = await slot.findByRole("dialog", { name: "Assign conversation to bot" });
    const chooser = within(dialog).getByRole("combobox", { name: "Bot" });
    expect((within(dialog).getByRole("button", { name: "Assign" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(chooser, { key: "ArrowDown" });
    expect(within(document.body).getAllByRole("option").map((option) => option.textContent)).toEqual([bot.name, "Unlinked bot", "Legacy owner"]);
    fireEvent.click(within(document.body).getByRole("option", { name: "Unlinked bot" }));
    expect((within(dialog).getByRole("button", { name: "Assign" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("allows an unlinked bot for a project-associated conversation without a link-first requirement", async () => {
    const { slot } = await mount({ rows: [thread("unassigned", 99, { projectId: "unrelated" })], bindings: [] });
    fireEvent.contextMenu(slot.getByText("Conversation unassigned"));
    fireEvent.click(await slot.findByRole("menuitem", { name: "Assign to bot…" }));
    const dialog = await slot.findByRole("dialog", { name: "Assign conversation to bot" });
    expect(within(dialog).queryByText(/No eligible bots|link this conversation’s project in Edit bot first/)).toBeNull();
    expect((within(dialog).getByRole("button", { name: "Assign" }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(dialog).getByRole("combobox", { name: "Bot" })).toBeTruthy();
    expect(slot.inspection.rpcCalls.some(call => call.method === "conversation_assign")).toBe(false);
  });

  it("only asks to create a bot when there are genuinely no bots", async () => {
    const { slot } = await mount({ bots: [], rows: [thread("unassigned", 99)], bindings: [] });
    fireEvent.contextMenu(slot.getByText("Conversation unassigned"));
    fireEvent.click(await slot.findByRole("menuitem", { name: "Assign to bot…" }));
    const dialog = await slot.findByRole("dialog", { name: "Assign conversation to bot" });
    expect(within(dialog).getByText("No bots yet. Create a bot first.")).toBeTruthy();
    expect(within(dialog).queryByRole("combobox")).toBeNull();
    expect((within(dialog).getByRole("button", { name: "Assign" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("assigns an existing project conversation to a bot and removes it and inherited children from Chats", async () => {
    const { slot } = await mount({ rows: [thread("main", 100), thread("unassigned", 99), thread("child", 98, { parentThreadId: "unassigned" })], activeThreadId: "unassigned" });
    fireEvent.contextMenu(slot.getByText("Conversation unassigned"));
    fireEvent.click(await slot.findByRole("menuitem", { name: "Assign to bot…" }));
    const dialog = await slot.findByRole("dialog", { name: "Assign conversation to bot" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_assign", input: { botId: bot.id, threadId: "unassigned" } });
    await waitFor(() => expect(slot.container.querySelector('.thread-row [data-sidebar-thread-id="unassigned"]')).not.toBeNull());
    expect(slot.container.querySelector('.recent-row [data-sidebar-thread-id="unassigned"]')).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Expand children of Conversation unassigned" }));
    expect(slot.container.querySelector('.thread-row [data-sidebar-thread-id="child"]')).not.toBeNull();
    expect(slot.container.querySelector('.recent-row [data-sidebar-thread-id="child"]')).toBeNull();
    expect(slot.inspection.rpcCalls.some((call) => call.method === "main_set")).toBe(false);
  });

  it("does not wake a hidden bot from another bot’s activity in the shared project", async () => {
    const hidden = { ...bot, id: "hidden", name: "Hidden identity", mainThreadId: null, hiddenUntilActivity: true, hiddenAt: 10 };
    const { slot } = await mount({ bots: [bot, hidden], rows: [thread("main", 1000)] });
    expect(slot.getByRole("button", { name: "1 hidden" })).toBeTruthy();
    expect(slot.inspection.rpcCalls.some((call) => call.method === "visibility_set")).toBe(false);
  });

  it("never infers ownership or hidden-bot activity from the shared personal project or a legacy project", async () => {
    const legacy = { ...bot, legacyHomeProjectId: "legacy-project" };
    const hidden = { ...bot, id: "hidden", name: "Hidden identity", mainThreadId: null, linkedProjectIds: [], hiddenUntilActivity: true, hiddenAt: 10 };
    const { slot } = await mount({ bots: [legacy, hidden], rows: [
      thread("main", 1000, { projectId: personalProjectId }),
      thread("personal-unassigned", 1001, { projectId: personalProjectId }),
      thread("legacy-unassigned", 1002, { projectId: "legacy-project" }),
    ] });
    for (const id of ["personal-unassigned", "legacy-unassigned"]) {
      expect(slot.container.querySelector(`[data-sidebar-thread-id="${id}"]`)?.closest(".recent-row")).not.toBeNull();
    }
    expect(slot.getByRole("button", { name: "1 hidden" })).toBeTruthy();
    expect(slot.inspection.rpcCalls.some((call) => call.method === "visibility_set" || call.method === "conversation_assign")).toBe(false);
  });

  it("offers every bot for explicit personal-chat assignment without claiming it beforehand", async () => {
    const unlinked = { ...bot, id: "unlinked", name: "Unlinked bot", linkedProjectIds: [], mainThreadId: null };
    const { slot } = await mount({ bots: [bot, unlinked], rows: [thread("personal-chat", 99, { projectId: personalProjectId })], bindings: [], activeThreadId: "personal-chat" });
    expect(slot.container.querySelector('.recent-row [data-sidebar-thread-id="personal-chat"]')).not.toBeNull();
    fireEvent.contextMenu(slot.getByText("Conversation personal-chat"));
    fireEvent.click(await slot.findByRole("menuitem", { name: "Assign to bot…" }));
    const dialog = await slot.findByRole("dialog", { name: "Assign conversation to bot" });
    const chooser = within(dialog).getByRole("combobox", { name: "Bot" });
    fireEvent.keyDown(chooser, { key: "ArrowDown" });
    expect(within(document.body).getAllByRole("option").map((option) => option.textContent)).toEqual([bot.name, unlinked.name]);
    fireEvent.click(within(document.body).getByRole("option", { name: unlinked.name }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_assign", input: { botId: unlinked.id, threadId: "personal-chat" } });
    await waitFor(() => expect(slot.container.querySelector('.thread-row [data-sidebar-thread-id="personal-chat"]')).not.toBeNull());
  });

  it("preserves a legacy main pointer/history but uses the personal project for fresh Move main", async () => {
    const legacy = { ...bot, legacyHomeProjectId: "legacy-project" };
    const { slot } = await mount({ bots: [legacy], rows: [thread("main", 100, { projectId: "legacy-project" })] });
    fireEvent.click(slot.getByRole("button", { name: /^Test bot/ }));
    expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "open", threadId: "main" });
    await menu(slot, bot.name, "New conversation…");
    await slot.findByRole("dialog", { name: "New conversation" });
    expect(composer.props?.defaultProjectId).toBe(personalProjectId);
    expect(composer.props?.defaultEnvironment).toEqual(personalEnvironment);
    await act(async () => { await expect(composer.props!.onSubmit({ ...request, projectId: "legacy-project" })).rejects.toThrow("Choose no project or an available work project"); });
    expect(slot.inspection.rpcCalls.some((call) => call.method === "conversation_create")).toBe(false);
    await act(() => composer.props!.onSubmit(personalRequest));
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_create", input: { botId: bot.id, request: personalRequest, makeMain: false } });
    await waitFor(() => expect(slot.container.querySelector('.thread-row [data-sidebar-thread-id="main"]')).not.toBeNull());
    expect(slot.inspection.rpcCalls.some((call) => call.method === "main_set")).toBe(false);
  });

  it("accepts the personal project selected from a linked-worktree composer unchanged", async () => {
    const { slot } = await mount();
    await menu(slot, bot.name, "New conversation in worktree…");
    await slot.findByRole("dialog", { name: "New conversation in worktree" });
    expect(slot.queryByRole("button", { name: "Continue" })).toBeNull();
    const chosen = { ...personalRequest, environment: { type: "host" as const, hostId: "remote", workspace: { type: "personal" as const } } };
    await act(() => composer.props!.onSubmit(chosen));
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_create", input: { botId: bot.id, request: chosen, makeMain: false } });
  });

  it("exposes Owner above Member, refuses silent transfer, and submits the full membership payload", async () => {
    const other = { ...bot, id: "other", name: "Other bot", linkedProjectIds: ["second"], mainThreadId: null };
    const { slot } = await mount({
      bots: [{ ...bot, linkedProjectIds: ["project", "missing"] }, other],
      projectOwners: [{ projectId: "project", botId: bot.id }, { projectId: "second", botId: other.id }],
    });
    await menu(slot, bot.name, "Add / manage projects…");
    const dialog = await slot.findByRole("dialog", { name: "Edit bot" });
    expect(within(dialog).queryByRole("combobox", { name: "Second project role" })).toBeNull();
    linkProject(dialog, "Second project"); linkProject(dialog, "Brand new unrelated project");
    const shared = within(dialog).getByRole("combobox", { name: "Shared project role" }) as HTMLSelectElement;
    const second = within(dialog).getByRole("combobox", { name: "Second project role" }) as HTMLSelectElement;
    const unrelated = within(dialog).getByRole("combobox", { name: "Brand new unrelated project role" }) as HTMLSelectElement;
    const missing = within(dialog).getByRole("combobox", { name: "Unavailable project (missing) role" }) as HTMLSelectElement;
    expect(shared.value).toBe("owner");
    expect(second.value).toBe("member");
    expect(within(second).getByRole("option", { name: "Owner (Other bot)" })).toBeTruthy();
    expect((within(second).getByRole("option", { name: "Owner (Other bot)" }) as HTMLOptionElement).disabled).toBe(true);
    fireEvent.change(second, { target: { value: "owner" } });
    expect(second.value).toBe("member");
    expect(missing.value).toBe("member");
    fireEvent.change(shared, { target: { value: "member" } });
    fireEvent.change(unrelated, { target: { value: "owner" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink Unavailable project (missing)" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink Second project" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save bot" }));
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "bot_update", input: expect.objectContaining({
      botId: bot.id, linkedProjectIds: ["project", "unrelated"], ownedProjectIds: ["unrelated"],
    }) });
  });

  it("waits for fresh project roles before mounting an editor draft", async () => {
    const bots = [{ ...bot }]; const projectOwners: Array<{ projectId: string; botId: string }> = [];
    let waiting = false; let arrived!: () => void; let unblock!: () => void;
    const started = new Promise<void>((resolve) => { arrived = resolve; });
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    const { slot } = await mount({ bots, projectOwners, beforeList: async () => { if (waiting) { arrived(); await gate; } } });
    bots[0] = { ...bots[0]!, updatedAt: bot.updatedAt + 1 };
    projectOwners.push({ projectId: "project", botId: bot.id }); waiting = true;
    await menu(slot, bot.name, "Add / manage projects…");
    await act(async () => { await started; });
    try { expect(slot.queryByRole("dialog", { name: "Edit bot" })).toBeNull(); } finally { await act(async () => { unblock(); }); }
    const dialog = await slot.findByRole("dialog", { name: "Edit bot" });
    expect((within(dialog).getByRole("combobox", { name: "Shared project role" }) as HTMLSelectElement).value).toBe("owner");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save bot" }));
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "bot_update", input: expect.objectContaining({ ownedProjectIds: ["project"], expectedUpdatedAt: bot.updatedAt + 1 }) });
  });

  it("keeps role drafts and their original revision when ownership changes elsewhere", async () => {
    const bots = [{ ...bot }]; const projectOwners = [{ projectId: "project", botId: bot.id }];
    const { slot } = await mount({ bots, projectOwners });
    await menu(slot, bot.name, "Add / manage projects…");
    const dialog = await slot.findByRole("dialog", { name: "Edit bot" });
    const shared = within(dialog).getByRole("combobox", { name: "Shared project role" }) as HTMLSelectElement;
    fireEvent.change(shared, { target: { value: "member" } });
    bots[0] = { ...bots[0]!, updatedAt: bot.updatedAt + 1 };
    projectOwners.push({ projectId: "second", botId: bot.id });
    await slot.behavior.emitRealtime("project-bots-changed", {});
    expect(shared.value).toBe("member");
    expect(within(dialog).queryByRole("combobox", { name: "Second project role" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save bot" }));
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "bot_update", input: expect.objectContaining({ ownedProjectIds: [], expectedUpdatedAt: bot.updatedAt }) });
  });

  it("does not reuse a personal or legacy-home worktree", async () => {
    const { slot } = await mount({
      bots: [{ ...bot, legacyHomeProjectId: "legacy-project" }],
      rows: [thread("main", 100), thread("personal-topic", 99, { projectId: personalProjectId })],
      bindings: [{ botId: bot.id, threadId: "main" }, { botId: bot.id, threadId: "personal-topic" }],
    });
    fireEvent.contextMenu(slot.getByText("Conversation personal-topic"));
    fireEvent.click(await slot.findByRole("menuitem", { name: "New conversation in worktree…" }));
    const dialog = await slot.findByRole("dialog", { name: "New conversation in worktree" });
    expect(within(dialog).getByText("Start in a fresh worktree. Choose the branch and harness before sending.")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Continue" })).toBeNull();
    expect(composer.props?.defaultProjectId).toBe("project");
    expect(composer.props?.defaultEnvironment).toEqual({ type: "host", hostId: "host", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } });
  });

  it("surfaces backend warnings without turning projects into bots", async () => {
    const { slot } = await mount({ warnings: ["A legacy bot needs attention."] });
    expect(slot.getByRole("status").textContent).toBe("A legacy bot needs attention.");
    expect(slot.container.querySelectorAll(".project-group")).toHaveLength(1);
  });
});
