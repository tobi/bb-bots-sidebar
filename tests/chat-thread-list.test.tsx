// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThreadsState, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { ChatThreadList } from "../components/chat-thread-list";
import { filterChatThreads, type ChatScope } from "../components/chat-thread-list/chat-scope";
import { defaultPreferences, type PreferenceValues } from "../components/chat-thread-list/upstream/shared/preferences";
import { resetPreferencesSyncForTest } from "../components/chat-thread-list/upstream/app/preferences/preferences-sync";
import { resetSidebarDataCacheForTest } from "../components/chat-thread-list/upstream/app/model/use-sidebar-data";
import { thread } from "./fixtures";

const projects = [
  { id: "project", name: "Alpha project", isPersonal: false, href: "/projects/project", settingsHref: "/projects/project/settings" },
  { id: "second", name: "Beta project", isPersonal: false, href: "/projects/second", settingsHref: "/projects/second/settings" },
  { id: "personal", name: "Personal", isPersonal: true, href: "/projects/personal", settingsHref: "/projects/personal/settings" },
];
const rows = [
  thread("bot-root", 100),
  thread("bot-child", 99, { parentThreadId: "bot-root" }),
  thread("unassigned", 80, { title: "Zebra chat", displayTitle: "Zebra chat", environment: null }),
  thread("second-chat", 90, { projectId: "second", title: "Alpha chat", displayTitle: "Alpha chat", environment: null }),
  thread("personal-chat", 70, { projectId: "personal", title: "Middle chat", displayTitle: "Middle chat", environment: null }),
];
const scope: ChatScope = { bindings: [{ threadId: "bot-root", botId: "bot" }], detached: new Set(), ready: true, onAssign: vi.fn(), onPointerDown: vi.fn() };

beforeEach(() => { resetPreferencesSyncForTest(); resetSidebarDataCacheForTest(); localStorage.clear(); });
afterEach(cleanup);

async function mount(preferences: Partial<PreferenceValues> = {}, threads = rows, sections: PluginSidebarThreadsState["sections"] = []) {
  const current = { ...defaultPreferences(), organizationMode: "project" as const, environmentGrouping: false as const, showEmptyProjects: false, ...preferences };
  const onNavigate = vi.fn();
  const slot = renderSlot({ component: (props: PluginThreadListProps) => <ChatThreadList {...props} scope={scope} /> }, {
    activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate, searchQuery: "",
  }, {
    sidebarThreads: { projects, threads, sections },
    rpc: {
      listPreferences: () => ({ preferences: current }),
      setPreference: (input: unknown) => { const { key, value } = input as { key: keyof PreferenceValues; value: unknown }; Object.assign(current, { [key]: value }); return { key, value }; },
    },
    sdk: { threads: { update: async ({ threadId, title }) => makeThreadResponse({ id: threadId, title }) } },
    threadActions: (target, { requestRename }) => [
      { key: "bb--core/rename", pluginId: "bb--core", group: "organize", action: { label: "Rename", icon: "Edit", run: async () => requestRename(target.id) } },
      { key: "test/status", pluginId: "test", group: "settings", action: { label: "Plugin action", icon: "Info", run: vi.fn(async () => {}) } },
    ],
  });
  await slot.findByText("Zebra chat");
  return { slot, current, onNavigate };
}

function ids(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-sidebar-thread-id]"), row => row.dataset.sidebarThreadId);
}

it("filters explicit and inherited bot ownership, including archived rows, while preserving detached chats", () => {
  const all = [...rows, thread("detached", 10, { parentThreadId: "bot-root" }), thread("archived", 1, { isArchived: true, archivedAt: 1 })];
  const state: PluginSidebarThreadsState = { status: "ready", threads: all, projects, sections: [], experimental_archived: null };
  const filtered = filterChatThreads(state, { ...scope, bindings: [...scope.bindings, { threadId: "archived", botId: "bot" }], detached: new Set(["detached"]) });
  expect(filtered.threads.map(row => row.id)).toEqual(["unassigned", "second-chat", "personal-chat", "detached"]);
  expect(filtered.projects).toBe(projects);
  expect(state.threads).toHaveLength(all.length);
  expect(filterChatThreads(state, { ...scope, ready: false })).toMatchObject({ status: "loading", threads: [] });
});

it("groups Chats by project and excludes bot conversations from every group", async () => {
  const { slot } = await mount();
  expect(slot.getByText("Alpha project")).toBeTruthy();
  expect(slot.getByText("Beta project")).toBeTruthy();
  expect(ids(slot.container)).toEqual(["unassigned", "second-chat", "personal-chat"]);
});

it.each([
  { chronologicalSort: "updated" as const, sortDirection: "descending" as const, expected: ["second-chat", "unassigned", "personal-chat"] },
  { chronologicalSort: "updated" as const, sortDirection: "ascending" as const, expected: ["personal-chat", "unassigned", "second-chat"] },
  { chronologicalSort: "alpha" as const, sortDirection: "ascending" as const, expected: ["second-chat", "personal-chat", "unassigned"] },
  { chronologicalSort: "created" as const, sortDirection: "descending" as const, expected: ["second-chat", "unassigned", "personal-chat"] },
])("preserves native $chronologicalSort sorting in $sortDirection order", async ({ expected, ...preferences }) => {
  const { slot } = await mount({ organizationMode: "chronological", ...preferences });
  expect(ids(slot.container)).toEqual(expected);
});

it("keeps pins separate and renders native custom sections", async () => {
  const pinned = thread("pinned", 2, { projectId: "personal", isPinned: true, pinnedAt: 1, environment: null });
  const { slot } = await mount({ organizationMode: "chronological" }, [
    ...rows.map(row => row.id === "unassigned" ? { ...row, sectionId: "later" } : row), pinned,
  ], [{ id: "later", name: "Later", createdAt: 1, updatedAt: 1 }]);
  expect(slot.getByText("Pinned")).toBeTruthy();
  expect(slot.getByText("Later")).toBeTruthy();
  expect(ids(slot.container)[0]).toBe("pinned");
});

it("preserves other plugins' actions and adds explicit bot assignment", async () => {
  const { slot } = await mount();
  fireEvent.contextMenu(slot.getByText("Zebra chat"));
  expect(await slot.findByRole("menuitem", { name: "Plugin action" })).toBeTruthy();
  fireEvent.click(slot.getByRole("menuitem", { name: "Assign to bot…" }));
  expect(scope.onAssign).toHaveBeenCalledWith(expect.objectContaining({ id: "unassigned" }));
});

it("uses native inline rename and preserves link and keyboard navigation contracts", async () => {
  const { slot, onNavigate } = await mount();
  const link = slot.container.querySelector<HTMLAnchorElement>('[data-sidebar-thread-id="unassigned"]')!;
  expect(link.hasAttribute("data-sidebar-thread-shortcut-target")).toBe(true);
  expect(link.getAttribute("href")).toBe("/projects/project/threads/unassigned");
  fireEvent.click(link);
  expect(onNavigate).toHaveBeenCalledOnce();
  fireEvent.contextMenu(slot.getByText("Zebra chat"));
  fireEvent.click(await slot.findByRole("menuitem", { name: "Rename" }));
  const input = await slot.findByRole("textbox", { name: "Thread name" });
  fireEvent.change(input, { target: { value: "Renamed chat" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(slot.inspection.sdkCalls).toContainEqual({ method: "threads.update", args: [{ threadId: "unassigned", title: "Renamed chat" }] }));
});

it("uses the native group menu for organization, sorting, filtering, and section creation", async () => {
  const { slot } = await mount({ organizationMode: "chronological" });
  fireEvent.pointerDown(slot.getByRole("button", { name: "Threads actions" }), { button: 0, ctrlKey: false, pointerType: "mouse" });
  expect(await slot.findByRole("menuitem", { name: "Organize" })).toBeTruthy();
  expect(slot.getByRole("menuitem", { name: "Sort by" })).toBeTruthy();
  expect(slot.getByRole("menuitem", { name: "Filter" })).toBeTruthy();
  expect(slot.getByRole("menuitem", { name: "New section" })).toBeTruthy();
});

it("keeps native nested threads independently collapsible without navigation", async () => {
  const { slot, onNavigate } = await mount({ organizationMode: "chronological" }, [
    ...rows,
    thread("child-chat", 60, { parentThreadId: "unassigned", environment: null }),
    thread("grandchild-chat", 50, { parentThreadId: "child-chat", environment: null }),
  ]);
  expect(slot.getByText("Conversation grandchild-chat")).toBeTruthy();
  fireEvent.click(slot.getByRole("button", { name: "Collapse Conversation child-chat threads" }));
  expect(slot.queryByText("Conversation grandchild-chat")).toBeNull();
  fireEvent.click(slot.getByRole("button", { name: "Collapse Zebra chat threads" }));
  expect(slot.queryByText("Conversation child-chat")).toBeNull();
  fireEvent.click(slot.getByRole("button", { name: "Expand Zebra chat threads" }));
  expect(slot.getByText("Conversation child-chat")).toBeTruthy();
  expect(slot.queryByText("Conversation grandchild-chat")).toBeNull();
  expect(onNavigate).not.toHaveBeenCalled();
});
