// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { bot, personalProjectId, thread } from "./fixtures";

const app = await loadPluginApp(() => import("../app"));
const Sidebar = app.threadLists[0]!.component;
afterEach(cleanup);

async function mount(initialActive: string | null = "main", topics = true) {
  const metadata = { ...bot };
  const rows = [
    thread("main", 1000),
    thread("main-child", 100, { parentThreadId: "main" }),
    thread("main-sibling", 90, { parentThreadId: "main" }),
    thread("main-grandchild", 80, { parentThreadId: "main-child" }),
    ...(topics ? [
      ...Array.from({ length: 6 }, (_, index) => thread(`topic-${index}`, 200 - index)),
      thread("topic-child", 190, { parentThreadId: "topic-0" }),
    ] : []),
  ];
  const onNavigate = vi.fn();
  function Host() {
    const [activeThreadId, setActive] = useState(initialActive);
    return <>
      <button onClick={() => setActive("main-grandchild")}>Go main grandchild</button>
      <button onClick={() => setActive("topic-child")}>Go topic child</button>
      <button onClick={() => setActive(null)}>Go elsewhere</button>
      <Sidebar activeThreadId={activeThreadId} activeProjectId="project" isCompactViewport={false} onNavigate={onNavigate} searchQuery="" Original={() => null} />
    </>;
  }
  const slot = renderSlot({ component: Host }, {}, {
    sidebarThreads: { projects: [{ id: "project", name: "Project", isPersonal: false }], threads: rows },
    rpc: {
      bots_list: () => ({ personalProjectId, bots: [{ ...metadata }], sections: [], hosts: [], projects: [{ id: "project", name: "Project" }], warnings: [], threadBindings: ["main", ...rows.filter((row) => row.id !== "main" && !row.parentThreadId).map((row) => row.id)].map((threadId) => ({ threadId, botId: bot.id })) }),
      main_set: (input) => { metadata.mainThreadId = (input as { threadId: string }).threadId; return metadata; },
    },
  });
  await slot.findByText(bot.name);
  const botRow = slot.getByText(bot.name).closest<HTMLElement>(".project-row")!;
  return { slot, botRow, onNavigate };
}

it("clicking a bot reveals recent topics and overflow but leaves main children collapsed", async () => {
  const { slot, botRow } = await mount(null);
  expect(slot.queryByRole("group", { name: `Top-level conversations for ${bot.name}` })).toBeNull();
  const mainToggle = within(botRow).getByRole("button", { name: `Expand children of ${bot.name}` });
  expect(mainToggle.textContent?.trim()).toBe("2");
  expect(botRow.lastElementChild).toBe(mainToggle);
  fireEvent.click(within(botRow).getAllByRole("button")[0]!);
  const topics = await slot.findByRole("group", { name: `Top-level conversations for ${bot.name}` });
  expect(topics.querySelectorAll("[data-sidebar-thread-id]")).toHaveLength(5);
  expect(within(topics).getByRole("button", { name: "1 Other" }).getAttribute("aria-expanded")).toBe("false");
  expect(mainToggle.getAttribute("aria-expanded")).toBe("false");
  expect(slot.queryByText("Conversation main-child")).toBeNull();
  expect(slot.queryByText("Conversation topic-child")).toBeNull();
  expect(slot.inspection.sidebarActionCalls).toEqual([{ method: "open", threadId: "main", options: undefined }]);
});

it("main children and top-level topics have separate groups and independent disclosure", async () => {
  const { slot, botRow } = await mount();
  const topics = await slot.findByRole("group", { name: `Top-level conversations for ${bot.name}` });
  fireEvent.click(within(botRow).getByRole("button", { name: `Expand children of ${bot.name}` }));
  const main = slot.getByRole("group", { name: `Children of ${bot.name}’s main conversation` });
  expect(main.querySelectorAll("[data-sidebar-thread-id]")).toHaveLength(2);
  expect(topics.querySelectorAll("[data-sidebar-thread-id]")).toHaveLength(5);
  expect(slot.queryByText("Main’s children", { exact: true })).toBeNull();
  expect(slot.queryByText("Topics", { exact: true })).toBeNull();
  expect(within(topics).queryByText("Conversation main-child")).toBeNull();
  expect(within(main).queryByText("Conversation topic-0")).toBeNull();
  expect(main.compareDocumentPosition(topics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(topics.getAttribute("data-main-children-visible")).toBe("true");
  fireEvent.click(within(main).getByRole("button", { name: "Expand children of Conversation main-child" }));
  expect(within(main).getByText("Conversation main-grandchild")).toBeTruthy();
  fireEvent.click(within(topics).getByRole("button", { name: "Expand children of Conversation topic-0" }));
  expect(within(topics).getByText("Conversation topic-child")).toBeTruthy();
  expect(within(botRow).getByRole("button", { name: `Collapse children of ${bot.name}` }).textContent?.trim()).toBe("2");
  fireEvent.click(within(botRow).getByRole("button", { name: `Collapse children of ${bot.name}` }));
  expect(slot.queryByRole("group", { name: `Children of ${bot.name}’s main conversation` })).toBeNull();
  expect(within(topics).getByText("Conversation topic-child")).toBeTruthy();
  expect(topics.querySelectorAll("[data-sidebar-thread-id]")).toHaveLength(6);
  fireEvent.click(within(topics).getByRole("button", { name: "1 Other" }));
  expect(topics.querySelectorAll("[data-sidebar-thread-id]")).toHaveLength(7);
  expect(slot.queryByRole("group", { name: `Children of ${bot.name}’s main conversation` })).toBeNull();
  expect(slot.inspection.sidebarActionCalls).toEqual([]);
});

it("hiding topics does not collapse the main's children, and clicking the bot restores topics", async () => {
  const { slot, botRow } = await mount();
  fireEvent.click(within(botRow).getByRole("button", { name: `Expand children of ${bot.name}` }));
  fireEvent.contextMenu(botRow);
  fireEvent.click(await slot.findByRole("menuitem", { name: "Hide topics" }));
  expect(slot.queryByRole("group", { name: `Top-level conversations for ${bot.name}` })).toBeNull();
  expect(slot.getByRole("group", { name: `Children of ${bot.name}’s main conversation` })).toBeTruthy();
  fireEvent.click(within(botRow).getAllByRole("button")[0]!);
  expect(slot.getByRole("group", { name: `Top-level conversations for ${bot.name}` })).toBeTruthy();
  expect(within(botRow).getByRole("button", { name: `Collapse children of ${bot.name}` }).getAttribute("aria-expanded")).toBe("true");
});

it("reveals the active main descendant without confusing it with a top-level topic", async () => {
  const { slot, botRow } = await mount();
  fireEvent.click(slot.getByRole("button", { name: "Go main grandchild" }));
  await slot.findByText("Conversation main-grandchild");
  const main = slot.getByRole("group", { name: `Children of ${bot.name}’s main conversation` });
  const active = main.querySelector('[data-sidebar-thread-id="main-grandchild"]');
  expect(active?.getAttribute("aria-current")).toBe("page");
  expect(within(botRow).getByRole("button", { name: `Collapse children of ${bot.name}` }).getAttribute("aria-expanded")).toBe("true");
  expect(slot.queryByText("Conversation topic-child")).toBeNull();
  fireEvent.click(slot.getByRole("button", { name: "Go topic child" }));
  const topics = slot.getByRole("group", { name: `Top-level conversations for ${bot.name}` });
  await waitFor(() => expect(topics.querySelector('[data-sidebar-thread-id="topic-child"]')?.getAttribute("aria-current")).toBe("page"));
  expect(active?.hasAttribute("aria-current")).toBe(false);
  fireEvent.click(slot.getByRole("button", { name: "Go elsewhere" }));
  await waitFor(() => expect(slot.queryByRole("group", { name: `Top-level conversations for ${bot.name}` })).toBeNull());
  expect(within(botRow).getByRole("button", { name: `Expand children of ${bot.name}` })).toBeTruthy();
});

it("updates the main-only count and resets its branch when another topic becomes main", async () => {
  const { slot, botRow } = await mount();
  fireEvent.click(within(botRow).getByRole("button", { name: `Expand children of ${bot.name}` }));
  const topics = slot.getByRole("group", { name: `Top-level conversations for ${bot.name}` });
  fireEvent.contextMenu(within(topics).getByText("Conversation topic-0"));
  fireEvent.click(await slot.findByRole("menuitem", { name: "Make main conversation" }));
  await waitFor(() => expect(within(botRow).getByRole("button", { name: `Expand children of ${bot.name}` }).textContent?.trim()).toBe("1"));
  expect(within(topics).getByText("Conversation main")).toBeTruthy();
  expect(within(topics).getByRole("button", { name: "Expand children of Conversation main" }).textContent?.trim()).toBe("2");
  expect(slot.queryByText("Conversation main-child")).toBeNull();
  expect(slot.queryByText("Conversation topic-child")).toBeNull();
});

it("can reveal main children without selecting the bot or showing its topics", async () => {
  const { slot, botRow } = await mount(null);
  fireEvent.click(within(botRow).getByRole("button", { name: `Expand children of ${bot.name}` }));
  expect(slot.getByRole("group", { name: `Children of ${bot.name}’s main conversation` })).toBeTruthy();
  expect(slot.queryByRole("group", { name: `Top-level conversations for ${bot.name}` })).toBeNull();
  expect(slot.inspection.sidebarActionCalls).toEqual([]);
});

it("does not add an empty Topics section when the main has only children", async () => {
  const { slot, botRow } = await mount("main", false);
  expect(slot.queryByRole("group", { name: `Top-level conversations for ${bot.name}` })).toBeNull();
  fireEvent.click(within(botRow).getByRole("button", { name: `Expand children of ${bot.name}` }));
  expect(slot.getByText("Conversation main-child")).toBeTruthy();
  expect(slot.queryByText("Topics", { exact: true })).toBeNull();
});
