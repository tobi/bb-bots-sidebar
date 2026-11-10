import { expandBot } from "./select-helper";
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, within } from "@testing-library/react";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { renderSlot } from "./sidebar-host";
import { bot, personalProjectId, thread } from "./fixtures";

const app = await loadPluginApp(() => import("../app"));
afterEach(cleanup);
async function mount(personal: boolean) {
  const rows = [thread("main", 200), thread("root", 150), thread("child", 140, { parentThreadId: "root" }),
    thread("main-child", 1, { parentThreadId: "main" }), thread("old-leaf", 1, { title: null, titleFallback: "Older conversation" }),
    thread("archived", 500, { isArchived: true }), ...Array.from({ length: 9 }, (_, i) => thread(`recent-${i}`, 100 - i)),
  ].map(row => ({ ...row, projectId: personal ? personalProjectId : "project" }));
  const onNavigate = vi.fn();
  const slot = renderSlot(app.threadLists[0]!, { activeThreadId: "root", activeProjectId: rows[0]!.projectId, isCompactViewport: false, onNavigate, searchQuery: "" }, {
    sidebarThreads: { projects: [{ id: rows[0]!.projectId, name: "Project", isPersonal: personal, href: "/projects/project", settingsHref: "/projects/project/settings" }], threads: rows },
    rpc: { bots_list: () => ({ bots: personal ? [] : [bot], personalProjectId, hosts: [], sections: [], projects: [], warnings: [], threadBindings: personal ? [] : rows.filter(row => !row.parentThreadId).map(row => ({ threadId: row.id, botId: bot.id })) }) },
  });
  if (!personal) await expandBot(slot, "Test bot");
  await slot.findByText("Conversation root");
  return { slot, onNavigate };
}

it.each([false, true])("requests native archive without prematurely hiding rows before confirmation (Chats=%s)", async (personal) => {
  const { slot, onNavigate } = await mount(personal);
  const link = slot.container.querySelector('[data-sidebar-thread-id="root"]')!;
  const row = personal ? link.closest<HTMLElement>("[data-sidebar-rename-row]")! : link.parentElement!;
  const archive = within(row).getByRole("button", { name: personal ? "Archive conversation" : "Archive Conversation root" });
  expect(archive.closest("a")).toBeNull();
  // The disclosure leads the row. Chats rows end with archive; bot rows end with the
  // complete checkbox, and archive sits in the pop-down below it.
  if (!personal) {
    const disclosure = within(row).getByRole("button", { name: "Expand children of Conversation root" });
    expect(row.firstElementChild).toBe(disclosure); expect(disclosure.nextElementSibling).toBe(link);
    const actions = row.lastElementChild!;
    expect(actions.classList.contains("conversation-actions")).toBe(true); expect(actions.previousElementSibling).toBe(link);
    expect(actions.firstElementChild?.getAttribute("data-complete-thread-id")).toBe("root");
    expect(archive.closest(".conversation-actions-menu")?.parentElement).toBe(actions);
  }
  fireEvent.click(archive, { ctrlKey: true });
  expect(slot.nativeActionCalls).toEqual([{ key: "bb--core/archive", threadId: "root" }]);
  expect(slot.container.querySelector('[data-sidebar-thread-id="root"]')).not.toBeNull();
  expect(onNavigate).not.toHaveBeenCalled(); expect(slot.inspection.navigateCalls).toEqual([]);
  expect(slot.inspection.rpcCalls.map(call => call.method).filter(method => method !== "workflow_runs" && method !== "listPreferences")).toEqual(["bots_list"]);
});

it.each([false, true])("gives each expanded child its own archive action (Chats=%s)", async (personal) => {
  const { slot } = await mount(personal);
  if (!personal) fireEvent.click(slot.getByRole("button", { name: "Expand children of Conversation root" }));
  const child = slot.container.querySelector('[data-sidebar-thread-id="child"]')!;
  const row = personal ? child.closest<HTMLElement>("[data-sidebar-rename-row]")! : child.parentElement!;
  fireEvent.click(within(row).getByRole("button", { name: personal ? "Archive conversation" : "Archive Conversation child" }));
  expect(slot.nativeActionCalls).toEqual([{ key: "bb--core/archive", threadId: "child" }]);
  expect(slot.queryByText("Conversation child")).not.toBeNull();
  expect(slot.queryByRole("button", { name: personal ? /Conversation root threads/ : /children of Conversation root/ })).not.toBeNull();
});

it.each([false, true])("supports archiving overflow rows without opening a conversation (Chats=%s)", async (personal) => {
  const { slot, onNavigate } = await mount(personal);
  const link = slot.container.querySelector('[data-sidebar-thread-id="old-leaf"]')!;
  const row = personal ? link.closest<HTMLElement>("[data-sidebar-rename-row]")! : link.parentElement!;
  const archive = within(row).getByRole("button", { name: personal ? "Archive conversation" : "Archive Older conversation" });
  expect(archive.getAttribute(personal ? "data-thread-action" : "data-archive-thread-id")).toBe(personal ? "bb--core/archive" : "old-leaf");
  fireEvent.keyDown(archive, { key: "Enter" }); fireEvent.click(archive, { detail: 0 });
  expect(slot.nativeActionCalls).toEqual([{ key: "bb--core/archive", threadId: "old-leaf" }]);
  expect(onNavigate).not.toHaveBeenCalled();
});

it("archives a main child, never the bot identity or main pointer", async () => {
  const { slot } = await mount(false);
  expect(slot.container.querySelector(".project-row .conversation-archive")).toBeNull();
  expect(slot.queryByRole("button", { name: "Archive Conversation archived" })).toBeNull();
  fireEvent.click(slot.getByRole("button", { name: "Expand children of Conversation main" }));
  fireEvent.click(slot.getByRole("button", { name: "Archive Conversation main-child" }));
  expect(slot.nativeActionCalls).toEqual([{ key: "bb--core/archive", threadId: "main-child" }]);
  expect(slot.inspection.rpcCalls.map(call => call.method).filter(method => method !== "workflow_runs" && method !== "listPreferences")).toEqual(["bots_list"]);
});
