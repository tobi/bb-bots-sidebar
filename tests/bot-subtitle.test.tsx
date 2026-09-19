// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { bot, personalProjectId, thread } from "./fixtures";

const app = await loadPluginApp(() => import("../app"));
afterEach(cleanup);

it("keeps the role and owned projects in the bot subtitle through folding and ownership updates", async () => {
  let owners = [{ botId: bot.id, projectId: "owned" }, { botId: bot.id, projectId: "second" }, { botId: "other", projectId: "member" }];
  const slot = renderSlot(app.threadLists[0]!, { activeThreadId: null, activeProjectId: "member", isCompactViewport: false, onNavigate() {}, searchQuery: "", Original: () => null }, {
    sidebarThreads: { projects: [], threads: [thread("main", 100, { projectId: "member", title: "Thread title must not replace role" })] },
    rpc: { bots_list: () => ({ bots: [{ ...bot, role: "Project assistant", linkedProjectIds: ["owned", "second", "member"] }], personalProjectId, hosts: [], sections: [], warnings: [],
      projects: [{ id: "owned", name: "Atlas" }, { id: "second", name: "Beacon" }, { id: "member", name: "Member only" }],
      projectOwners: owners, threadBindings: [{ botId: bot.id, threadId: "main" }],
    }) },
  });
  const row = (await slot.findByText(bot.name)).closest(".project-row")!;
  const subtitle = row.querySelector(".bot-subtitle")!;
  expect(subtitle.textContent).toBe("Project assistant · Atlas, Beacon");
  expect(subtitle.getAttribute("title")).toBe("Project assistant · Owned projects: Atlas, Beacon");
  expect(row.textContent).not.toContain("Thread title must not replace role");
  expect(row.textContent).not.toContain("Member only");
  fireEvent.click(slot.getByRole("button", { name: "Expand conversations for Test bot" }));
  expect(subtitle.textContent).toBe("Project assistant · Atlas, Beacon");
  fireEvent.click(slot.getByRole("button", { name: "Collapse conversations for Test bot" }));
  expect(subtitle.textContent).toBe("Project assistant · Atlas, Beacon");
  owners = [];
  await slot.behavior.emitRealtime("project-bots-changed", {});
  await waitFor(() => expect(subtitle.textContent).toBe("Project assistant"));
  expect(slot.inspection.sidebarActionCalls).toEqual([]);
});
