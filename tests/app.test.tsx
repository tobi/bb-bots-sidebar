// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { bot, personalProjectId, thread } from "./fixtures";

const app = await loadPluginApp(() => import("../app"));
afterEach(cleanup);

async function mount(withChat = false, status: Partial<ReturnType<typeof thread>> = {}, withHidden = false) {
  const onNavigate = vi.fn();
  const slot = renderSlot(app.threadLists[0]!, {
    activeThreadId: "main", activeProjectId: "project", isCompactViewport: false,
    onNavigate, searchQuery: "", Original: () => null,
  }, {
    sidebarThreads: {
      projects: [{ id: "project", name: "Test bot", isPersonal: false }, ...(withChat ? [{ id: "personal", name: "Personal", isPersonal: true }] : []), ...(withHidden ? [{ id: "hidden", name: "Hidden bot", isPersonal: false }] : [])],
      threads: [thread("main", 1000), ...Array.from({ length: 10 }, (_, i) => thread(String(i), 100 - i, i === 0 ? status : {})), ...(withChat ? [thread("chat", 200, { ...status, projectId: "personal", environment: null })] : [])],
    },
    rpc: { bots_list: () => ({ personalProjectId, bots: [bot, ...(withHidden ? [{ ...bot, id: "hidden", name: "Hidden bot", mainThreadId: null, hiddenUntilActivity: true, hiddenAt: 10000 }] : [])], hosts: [{ id: "host", name: "Local", connected: true }], sections: [], projects: [{ id: "project", name: "Project" }], threadBindings: ["main", ...Array.from({ length: 10 }, (_, i) => String(i))].map((threadId) => ({ threadId, botId: bot.id })), warnings: [] }), conversation_reorder: () => ({ ok: true }) },
  });
  await slot.findByText("Test bot");
  fireEvent.click(slot.getByRole("button", { name: "Expand conversations for Test bot" }));
  return { slot, onNavigate };
}

describe("Bots sidebar", () => {
  it("counts every top-level conversation in the bot disclosure", async () => {
    const { slot } = await mount();
    const row = slot.getByText("Test bot").closest<HTMLElement>(".project-row")!;
    expect(row.querySelector(".conversation-disclosure")?.textContent).toBe("11");
    expect(slot.container.querySelectorAll("[data-sidebar-thread-id]")).toHaveLength(11);
    expect(slot.getByRole("group", { name: "Conversations for Test bot" })).toBeTruthy();
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
  });
  it("uses an invisible Main section instead of an Unassigned heading", async () => {
    const { slot } = await mount(false, {}, false);
    expect(slot.getByText("Test bot")).toBeTruthy();
    expect(slot.queryByText("Main", { exact: true })).toBeNull();
    expect(slot.queryByText("Unassigned", { exact: true })).toBeNull();
    expect(slot.getByText("Test bot").closest(".bot-section")?.getAttribute("data-section-id")).toBe("unassigned");
  });
  it("has no activity-date labels and puts the hidden toggle below the bots", async () => {
    const { slot } = await mount(true, {}, true);
    expect(slot.queryByText(/^\d{1,2}\/\d{1,2}$/)).toBeNull();
    expect(slot.container.querySelector(".project-date")).toBeNull();
    const toggle = slot.getByRole("button", { name: "1 hidden" });
    expect(toggle.closest(".bots-list-footer")).not.toBeNull();
    const list = slot.container.querySelector(".bot-section")!;
    expect(list.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(toggle);
    expect(slot.getByText("Hidden bot")).toBeTruthy();
  });
  it("shows the ordered roots with only the requested inline archive action", async () => {
    const { slot } = await mount();
    expect(slot.container.querySelectorAll("[data-sidebar-thread-id]")).toHaveLength(11);
    expect(slot.container.querySelectorAll(".thread-row button:not(.conversation-archive), .project-row-actions")).toHaveLength(0);
    expect(slot.container.querySelectorAll(".thread-row .conversation-archive")).toHaveLength(11);
    expect(slot.queryByRole("button", { name: /Other/ })).toBeNull();
    expect(slot.container.querySelectorAll("[data-sidebar-thread-id]")).toHaveLength(11);
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
  });
  it.each([
    { indicator: "runtime" as const, label: "Working" },
    { indicator: "none" as const, label: "Done" },
  ])("shows $label icons on both bot conversations and Chats", async ({ indicator, label }) => {
    const { slot } = await mount(true, { indicator });
    for (const id of ["0", "chat"]) {
      const row = slot.container.querySelector<HTMLElement>(`[data-sidebar-thread-id="${id}"]`)!;
      expect(within(row).getByRole("img", { name: label })).toBeTruthy();
      expect(row.querySelectorAll(".conversation-status")).toHaveLength(1);
      expect(row.querySelector(".thread-indicator, .thread-branch")).toBeNull();
    }
  });
  it("archives a conversation through the host, not a private RPC", async () => {
    const { slot } = await mount();
    fireEvent.contextMenu(slot.getByText("Conversation 0"));
    fireEvent.click(await slot.findByRole("menuitem", { name: "Archive conversation" }));
    expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "archive", threadId: "0" });
  });
  it("gives Chats assignment and conversation actions without main/worktree actions", async () => {
    const { slot } = await mount(true);
    fireEvent.contextMenu(slot.getByText("Conversation chat"));
    const menu = await slot.findByRole("menu");
    expect(menu.hasAttribute("data-bb-plugin-root")).toBe(true);
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).every(item => item.classList.contains("bot-menu-item"))).toBe(true);
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]'), (item) => item.textContent)).toEqual(["Assign to bot…", "Rename…", "Open in split", "Mark as unread", "Archive conversation"]);
    fireEvent.click(slot.getByRole("menuitem", { name: "Archive conversation" }));
    expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "archive", threadId: "chat" });
  });
  it.each(["0", "chat"])("renames %s only on explicit Save", async (id) => {
    const { slot } = await mount(true);
    fireEvent.contextMenu(slot.getByText(`Conversation ${id}`));
    fireEvent.click(await slot.findByRole("menuitem", { name: "Rename…" }));
    const input = await slot.findByRole("textbox", { name: "Name" });
    expect((input as HTMLInputElement).value).toBe(`Conversation ${id}`);
    fireEvent.change(input, { target: { value: "  New name  " } });
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
    fireEvent.click(slot.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "rename", threadId: id, title: "New name" });
  });
  it.each([
    { label: "Mark as unread", expected: { method: "setRead", threadId: "chat", read: false } },
    { label: "Open in split", expected: { method: "open", threadId: "chat", options: { split: true } } },
  ])("runs the Chats action: $label", async ({ label, expected }) => {
    const { slot, onNavigate } = await mount(true);
    fireEvent.contextMenu(slot.getByText("Conversation chat"));
    fireEvent.click(await slot.findByRole("menuitem", { name: label }));
    expect(slot.inspection.sidebarActionCalls).toContainEqual(expected);
    if (label === "Open in split") expect(onNavigate).toHaveBeenCalledOnce();
  });
  it("offers Move to top instead of Make main", async () => {
    const { slot } = await mount();
    fireEvent.contextMenu(slot.getByText("Conversation 0"));
    fireEvent.click(await slot.findByRole("menuitem", { name: "Move to top" }));
    await waitFor(() => expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_reorder", input: { botId: bot.id, threadId: "0", targetThreadId: "main", position: "before" } }));
  });
  it("opens the host worktree composer from the bot without creating a thread yet", async () => {
    const { slot } = await mount();
    fireEvent.contextMenu(slot.getByText("Test bot"));
    fireEvent.click(await slot.findByRole("menuitem", { name: "New conversation in worktree…" }));
    await slot.findByRole("dialog", { name: "New conversation in worktree" });
    expect(slot.getByText("Start in a fresh worktree. Choose the branch and harness before sending.")).toBeTruthy();
    expect(slot.inspection.rpcCalls.some((call) => call.method === "conversation_create")).toBe(false);
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
  });
  it("offers a fresh worktree from an existing conversation", async () => {
    const { slot } = await mount();
    fireEvent.contextMenu(slot.getByText("Conversation 0"));
    fireEvent.click(await slot.findByRole("menuitem", { name: "New conversation in worktree…" }));
    await slot.findByRole("dialog", { name: "New conversation in worktree" });
    expect(slot.getByText("Start in a fresh worktree. Choose the branch and harness before sending.")).toBeTruthy();
  });
});
