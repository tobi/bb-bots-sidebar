// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { botConversationTree } from "../lib/conversations";
import { bot, personalProjectId, thread } from "./fixtures";

const inactive = (count = 9) => Array.from({ length: count }, (_, index) => thread(`idle-${index}`, 100 - index));
const busy = (count = 3) => Array.from({ length: count }, (_, index) => thread(`work-${index}`, index + 1, { indicator: "runtime" }));
const ids = (rows: ReturnType<typeof inactive>) => rows.map(row => row.id);
afterEach(cleanup);

it.each([0, 1000])("shows active roots first PLUS five inactive roots, regardless of active recency (%i)", (offset) => {
  const active = busy().map(row => ({ ...row, updatedAt: row.updatedAt + offset }));
  const result = botConversationTree([thread("main", 500), ...inactive(), ...active], "main", "main");
  expect(ids(result.recent)).toEqual(["work-2", "work-1", "work-0", "idle-0", "idle-1", "idle-2", "idle-3", "idle-4"]);
  expect(ids(result.other)).toEqual(["idle-5", "idle-6", "idle-7", "idle-8"]);
});

it("never caps the active group even when it is larger than five", () => {
  const result = botConversationTree([...inactive(), ...busy(20)], null, null);
  expect(result.recent).toHaveLength(25);
  expect(result.recent.slice(0, 20).every(row => row.id.startsWith("work-"))).toBe(true);
  expect(result.other).toHaveLength(4);
});

it.each([0, 1, 5])("does not add overflow for %i inactive conversations", (count) => {
  const result = botConversationTree(inactive(count), null, null);
  expect(result.recent).toHaveLength(count); expect(result.other).toEqual([]);
});

it("does not treat unread completions as active or exceed the five-inactive allowance", () => {
  const result = botConversationTree(inactive(20).map(row => ({ ...row, isUnread: true, indicator: "unread-success" })), null, null);
  expect(result.recent).toHaveLength(5); expect(result.other).toHaveLength(15);
});

it("keeps waiting and background-working branches outside overflow", () => {
  const result = botConversationTree([...inactive(),
    thread("waiting", 1, { hasPendingInteraction: true }),
    thread("paused", 2, { indicator: "waiting-for-input" }),
    thread("parent", 3), thread("child", 4, { parentThreadId: "parent" }),
    thread("working-descendant", 5, { parentThreadId: "child", activity: { workflows: 0, backgroundAgents: 1, backgroundCommands: 0, planMode: 0, goals: 0 } }),
  ], null, null);
  expect(ids(result.recent).slice(0, 3)).toEqual(["parent", "paused", "waiting"]);
  expect(result.recent).toHaveLength(8);
  expect(ids(result.other)).not.toContain("parent");
  expect(ids(result.childrenByParent.get("child")!)).toEqual(["working-descendant"]);
});

it("keeps viewed and pinned branches within—not in addition to—the five inactive slots", () => {
  const result = botConversationTree([...inactive(10).map(row => ({ ...row, isPinned: true })), thread("selected-child", 1, { parentThreadId: "idle-9" })], null, "selected-child");
  expect(result.recent).toHaveLength(5); expect(result.other).toHaveLength(5);
  expect(ids(result.recent)).toContain("idle-9");
});

it("promotes revived overflow and folds finished work without losing any conversation", () => {
  const rows = inactive(9); const initial = botConversationTree(rows, null, null);
  expect(ids(initial.other)).toContain("idle-8");
  rows[8] = { ...rows[8]!, indicator: "runtime" };
  const running = botConversationTree(rows, null, null);
  expect(running.recent[0]?.id).toBe("idle-8"); expect(running.recent).toHaveLength(6); expect(running.other).toHaveLength(3);
  rows[8] = { ...rows[8]!, indicator: "unread-success", isUnread: true, updatedAt: 200 };
  const done = botConversationTree(rows, null, null);
  expect(done.recent[0]?.id).toBe("idle-8"); expect(done.recent).toHaveLength(5); expect(done.other).toHaveLength(4);
  expect(new Set(ids([...done.recent, ...done.other])).size).toBe(9);
});

it("keeps main children separate and excludes archived activity from overflow budgeting", () => {
  const result = botConversationTree([thread("main", 500), ...inactive(),
    thread("main-child", 1, { parentThreadId: "main", indicator: "runtime" }),
    thread("archived", 1, { indicator: "runtime", isArchived: true }),
  ], "main", "main");
  expect(result.recent).toHaveLength(5); expect(result.other).toHaveLength(4);
  expect(ids(result.mainChildren)).toEqual(["main-child"]);
  expect(ids([...result.recent, ...result.other])).not.toContain("main-child");
});

const app = await loadPluginApp(() => import("../app"));
const Sidebar = app.threadLists[0]!.component;
async function mount() {
  const rows = [thread("main", 500), ...inactive(8), ...busy(),
    thread("old-child", 1, { parentThreadId: "idle-7" }),
    thread("main-child", 1, { parentThreadId: "main" }),
  ];
  const onNavigate = vi.fn();
  function Host() {
    const [activeThreadId, setActive] = useState("main");
    return <><button onClick={() => setActive("old-child")}>Navigate old child</button><Sidebar activeThreadId={activeThreadId} activeProjectId="project" isCompactViewport={false} onNavigate={onNavigate} searchQuery="" Original={() => null} /></>;
  }
  const slot = renderSlot({ component: Host }, {}, {
    sidebarThreads: { projects: [{ id: "project", name: "Work", isPersonal: false }], threads: rows },
    rpc: { bots_list: () => ({ bots: [bot], personalProjectId, sections: [], hosts: [], projects: [], warnings: [], threadBindings: rows.filter(row => !row.parentThreadId).map(row => ({ threadId: row.id, botId: bot.id })) }) },
  });
  const topics = await slot.findByRole("group", { name: `Top-level conversations for ${bot.name}` });
  return { slot, topics, onNavigate };
}

it("renders active plus five, and toggles the remaining roots without navigating or expanding children", async () => {
  const { slot, topics, onNavigate } = await mount();
  expect(Array.from(topics.querySelectorAll('[data-sidebar-thread-id]')).map(node => node.getAttribute("data-sidebar-thread-id"))).toEqual(["work-2", "work-1", "work-0", "idle-0", "idle-1", "idle-2", "idle-3", "idle-4"]);
  const overflow = within(topics).getByRole("button", { name: "3 Other" });
  expect(overflow.getAttribute("aria-expanded")).toBe("false"); expect(slot.queryByText("Conversation idle-7")).toBeNull();
  fireEvent.click(overflow);
  expect(overflow.getAttribute("aria-expanded")).toBe("true"); expect(slot.getByText("Conversation idle-7")).toBeTruthy();
  expect(slot.queryByText("Conversation old-child")).toBeNull(); expect(slot.queryByText("Conversation main-child")).toBeNull();
  fireEvent.click(overflow); expect(slot.queryByText("Conversation idle-7")).toBeNull();
  expect(onNavigate).not.toHaveBeenCalled(); expect(slot.inspection.sidebarActionCalls).toEqual([]);
});

it("reveals a selected old descendant while leaving overflow collapsed and inactive count bounded", async () => {
  const { slot, topics } = await mount();
  fireEvent.click(slot.getByRole("button", { name: "Navigate old child" }));
  await waitFor(() => expect(topics.querySelector('[data-sidebar-thread-id="old-child"]')?.getAttribute("aria-current")).toBe("page"));
  expect(within(topics).getByRole("button", { name: "3 Other" }).getAttribute("aria-expanded")).toBe("false");
  expect(topics.querySelectorAll('[data-sidebar-thread-id]')).toHaveLength(9); // 3 busy + 5 inactive + selected child
});
