// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { renderSlot } from "./sidebar-host";
import { bot, personalProjectId, thread } from "./fixtures";
import { expandBot } from "./select-helper";
import { defaultPreferences, type PreferenceValues } from "../components/chat-thread-list/upstream/shared/preferences";

const app = await loadPluginApp(() => import("../app"));
const Sidebar = app.threadLists[0]!.component;
afterEach(cleanup);

const run = {
  key: "worker:wfr_1", ownerThreadId: "worker", name: "category-investigation", runId: "wfr_1", status: "working", startedAt: 1,
  agents: [
    { threadId: "wf-a", title: "Research client-bot", status: "working", createdAt: 1 },
    { threadId: "wf-b", title: "Research paid-social", status: "idle", createdAt: 2 },
  ],
};

async function mount(initialActive: string | null = null, options: {
  assigned?: boolean;
  preferences?: Partial<PreferenceValues>;
  nested?: boolean;
  child?: boolean;
  pinned?: boolean;
} = {}) {
  const preferences = { ...defaultPreferences(), ...options.preferences };
  const rows = [thread("main", 100), thread("worker", 90, {
    parentThreadId: options.nested ? "main" : null,
    isPinned: options.pinned ?? false, pinnedAt: options.pinned ? 1 : null,
  })];
  if (options.child) rows.push(thread("real-child", 80, { parentThreadId: "worker" }));
  function Host() {
    const [activeThreadId, setActive] = useState<string | null>(initialActive);
    return <><button onClick={() => setActive("wf-b")}>View agent</button>
      <button onClick={() => setActive("wf-a")}>View other agent</button>
      <Sidebar activeThreadId={activeThreadId} activeProjectId="project" isCompactViewport={false} onNavigate={() => {}} searchQuery="" /></>;
  }
  const slot = renderSlot({ component: Host }, {}, {
    sidebarThreads: { projects: [{ id: "project", name: "Project", isPersonal: false, href: "/projects/project", settingsHref: "/projects/project/settings" }], threads: rows },
    rpc: {
      bots_list: () => ({ personalProjectId, bots: [{ ...bot, threadOrder: ["main", "worker"] }], sections: [], hosts: [], projects: [], warnings: [],
        threadBindings: options.assigned === false ? [] : rows.map((row) => ({ threadId: row.id, botId: bot.id })) }),
      workflow_runs: () => ({ runs: [run] }),
      listPreferences: () => ({ preferences }),
      setPreference: (input: unknown) => {
        const { key, value } = input as { key: keyof PreferenceValues; value: unknown };
        Object.assign(preferences, { [key]: value });
        return { key, value };
      },
    },
  });
  await slot.findByText(bot.name);
  return slot;
}

it("shows a live workflow as a virtual child that reveals and opens its agent threads", async () => {
  const slot = await mount();
  await expandBot(slot, bot.name);
  // The workflow alone gives the conversation a disclosure, and a live run reveals itself once.
  await slot.findByRole("button", { name: "Collapse children of Conversation worker" });
  const runRow = await slot.findByRole("button", { name: /^Show agents: category-investigation workflow, 1 running$/ });
  expect(runRow.closest("ul")?.classList.contains("conversation-children")).toBe(true);
  expect(slot.container.querySelector("[data-workflow-run] [data-complete-thread-id]")).toBeNull();
  expect(slot.queryByText("Research client-bot")).toBeNull();
  fireEvent.click(runRow);
  fireEvent.click(await slot.findByText("Research paid-social"));
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "wf-b", options: { split: false } });
  // Folding sticks while the same run keeps working.
  fireEvent.click(slot.getByRole("button", { name: "Collapse children of Conversation worker" }));
  expect(slot.queryByText("category-investigation")).toBeNull();
});

it("unfolds the bot, the owning conversation, and the run when one of its agent threads is viewed", async () => {
  const slot = await mount();
  fireEvent.click(slot.getByText("View agent"));
  const agent = await slot.findByText("Research paid-social");
  expect(agent.closest("a")?.getAttribute("aria-current")).toBe("page");
  expect(slot.getByRole("button", { name: "Collapse children of Conversation worker" })).toBeTruthy();
});

it("shows workflow children after real children in unassigned Chats and opens their agents", async () => {
  const slot = await mount(null, { assigned: false, child: true });
  const runRow = await slot.findByRole("button", { name: /^Show agents: category-investigation workflow/ });
  const child = slot.getByText("Conversation real-child");
  expect(child.compareDocumentPosition(runRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(slot.container.querySelector("[data-workflow-run] [data-complete-thread-id]")).toBeNull();
  fireEvent.click(runRow);
  fireEvent.click(slot.getByText("Research paid-social"));
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "wf-b", options: { split: false } });
});

it.each([false, true])("lets users fold workflow-only Chat children with read grouping %s", async (groupByReadStatus) => {
  const slot = await mount(null, { assigned: false, preferences: { groupByReadStatus, collapsedThreads: ["worker"] } });
  await slot.findByText("category-investigation");
  fireEvent.click(slot.getByRole("button", { name: "Collapse Conversation worker threads" }));
  expect(slot.queryByText("category-investigation")).toBeNull();
  await slot.behavior.emitRealtime("bots-workflow-runs-changed", {});
  expect(slot.queryByText("category-investigation")).toBeNull();
  fireEvent.click(slot.getByRole("button", { name: "Expand Conversation worker threads" }));
  expect(await slot.findByText("category-investigation")).toBeTruthy();
});

it.each(["chronological", "project", "machine"] as const)("reveals a workflow agent through folded native %s groups and Chat ancestors", async (organizationMode) => {
  const slot = await mount(null, { assigned: false, nested: true, preferences: {
    organizationMode, environmentGrouping: false, collapsedProjects: ["project"], collapsedThreads: ["main", "worker"],
    collapsedSections: ["threads"], collapsedMachines: ["host"],
  } });
  await waitFor(() => expect(slot.inspection.rpcCalls.some(call => call.method === "listPreferences")).toBe(true));
  expect(slot.queryByText("Research paid-social")).toBeNull();
  fireEvent.click(slot.getByText("View agent"));
  const agent = await slot.findByText("Research paid-social");
  expect(agent.closest("a")?.getAttribute("aria-current")).toBe("page");
  expect(slot.getByRole("button", { name: "Collapse Conversation worker threads" })).toBeTruthy();
  if (organizationMode === "project") {
    fireEvent.click(slot.getByRole("button", { name: "Collapse Project section" }));
    expect(slot.queryByText("Research client-bot")).toBeNull();
    fireEvent.click(slot.getByText("View other agent"));
    const otherAgent = await slot.findByText("Research client-bot");
    expect(otherAgent.closest("a")?.getAttribute("aria-current")).toBe("page");
  }
});

it("reveals workflow agents in a folded native Pinned section", async () => {
  const slot = await mount("wf-b", { assigned: false, pinned: true, preferences: {
    collapsedSections: ["pinned"], collapsedThreads: ["worker"],
  } });
  const agent = await slot.findByText("Research paid-social");
  expect(agent.closest("a")?.getAttribute("aria-current")).toBe("page");
  fireEvent.click(slot.getByRole("button", { name: "Collapse Conversation worker threads" }));
  expect(slot.queryByText("category-investigation")).toBeNull();
});
