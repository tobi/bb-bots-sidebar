// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { bot, personalProjectId, thread } from "./fixtures";

const app = await loadPluginApp(() => import("../app"));
afterEach(cleanup);
async function mount(personal: boolean) {
  const rows = [thread("main", 200), thread("root", 150), thread("child", 140, { parentThreadId: "root" }),
    thread("main-child", 1, { parentThreadId: "main" }), thread("old-leaf", 1, { title: null, titleFallback: "Older conversation" }),
    thread("archived", 500, { isArchived: true }), ...Array.from({ length: 9 }, (_, i) => thread(`recent-${i}`, 100 - i)),
  ].map(row => ({ ...row, projectId: personal ? personalProjectId : "project" }));
  const onNavigate = vi.fn();
  const slot = renderSlot(app.threadLists[0]!, { activeThreadId: "root", activeProjectId: rows[0]!.projectId, isCompactViewport: false, onNavigate, searchQuery: "", Original: () => null }, {
    sidebarThreads: { projects: [{ id: rows[0]!.projectId, name: "Project", isPersonal: personal }], threads: rows },
    rpc: { bots_list: () => ({ bots: personal ? [] : [bot], personalProjectId, hosts: [], sections: [], projects: [], warnings: [], threadBindings: personal ? [] : rows.filter(row => !row.parentThreadId).map(row => ({ threadId: row.id, botId: bot.id })) }) },
  });
  await slot.findByText("Conversation root");
  return { slot, onNavigate };
}

it.each([false, true])("archives the requested parent through BB without navigation or branch toggling (Chats=%s)", async (personal) => {
  const { slot, onNavigate } = await mount(personal);
  const link = slot.container.querySelector('[data-sidebar-thread-id="root"]')!;
  const row = link.parentElement!;
  const archive = within(row).getByRole("button", { name: "Archive Conversation root" });
  expect(archive.closest("a")).toBeNull(); expect(archive.previousElementSibling).toBe(link);
  const disclosure = within(row).getByRole("button", { name: "Expand children of Conversation root" });
  expect(row.lastElementChild).toBe(disclosure); expect(archive.nextElementSibling).toBe(disclosure);
  fireEvent.click(archive, { ctrlKey: true });
  expect(slot.inspection.sidebarActionCalls).toEqual([{ method: "archive", threadId: "root" }]);
  expect(slot.container.querySelector('[data-sidebar-thread-id="root"]')).toBeNull();
  expect(onNavigate).not.toHaveBeenCalled(); expect(slot.inspection.navigateCalls).toEqual([]);
  expect(slot.inspection.rpcCalls.map(call => call.method)).toEqual(["bots_list"]);
});

it.each([false, true])("gives each expanded child its own archive action (Chats=%s)", async (personal) => {
  const { slot } = await mount(personal);
  fireEvent.click(slot.getByRole("button", { name: "Expand children of Conversation root" }));
  fireEvent.click(slot.getByRole("button", { name: "Archive Conversation child" }));
  expect(slot.inspection.sidebarActionCalls).toEqual([{ method: "archive", threadId: "child" }]);
  expect(slot.queryByText("Conversation child")).toBeNull();
  expect(slot.queryByRole("button", { name: /children of Conversation root/ })).toBeNull();
});

it.each([false, true])("supports archiving overflow rows without opening a conversation (Chats=%s)", async (personal) => {
  const { slot, onNavigate } = await mount(personal);
  expect(slot.queryByRole("button", { name: "Archive Older conversation" })).toBeNull();
  fireEvent.click(slot.getByRole("button", { name: /^\d+ Other$/ }));
  const archive = slot.getByRole("button", { name: "Archive Older conversation" });
  expect(archive.getAttribute("data-archive-thread-id")).toBe("old-leaf");
  fireEvent.keyDown(archive, { key: "Enter" }); fireEvent.click(archive, { detail: 0 });
  expect(slot.inspection.sidebarActionCalls).toEqual([{ method: "archive", threadId: "old-leaf" }]);
  expect(onNavigate).not.toHaveBeenCalled();
});

it("archives a main child, never the bot identity or main pointer", async () => {
  const { slot } = await mount(false);
  expect(slot.container.querySelector(".project-row .conversation-archive")).toBeNull();
  expect(slot.queryByRole("button", { name: "Archive Conversation archived" })).toBeNull();
  fireEvent.click(slot.getByRole("button", { name: "Expand children of Test bot" }));
  fireEvent.click(slot.getByRole("button", { name: "Archive Conversation main-child" }));
  expect(slot.inspection.sidebarActionCalls).toEqual([{ method: "archive", threadId: "main-child" }]);
  expect(slot.inspection.rpcCalls.map(call => call.method)).toEqual(["bots_list"]);
});
