// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { BotActivityBadge } from "../components/bot-activity-badge";
import { bot, personalProjectId, thread } from "./fixtures";

afterEach(cleanup);
const running = (id: string) => thread(id, 100, { indicator: "runtime" });

it("shows a dedicated main spinner even with no other active conversations", () => {
  const view = render(<BotActivityBadge mainThreadId="main" threads={[running("main")]} />);
  expect(view.getByRole("img", { name: "Main conversation: Working" })).toBeTruthy();
  expect(view.container.querySelector(".bot-main-activity .conversation-status-working")).not.toBeNull();
  expect(view.container.querySelectorAll(".bot-other-working-dot")).toHaveLength(0);
});

it("places three other-conversation dots before the main spinner", () => {
  const view = render(<BotActivityBadge mainThreadId="main" threads={[running("main"), running("a"), running("b"), running("c")]} />);
  const badge = view.getByRole("img", { name: "Main conversation: Working; 3 other conversations working" });
  expect(badge.getAttribute("data-other-working-count")).toBe("3");
  expect(badge.querySelectorAll(".bot-other-working-dot")).toHaveLength(3);
  expect(badge.lastElementChild?.className).toBe("bot-main-activity");
});

it("does not imply the main is working when only other threads are active", () => {
  const view = render(<BotActivityBadge mainThreadId="main" threads={[thread("main", 1), running("other")]} />);
  expect(view.getByRole("img", { name: "Main conversation: Done; 1 other conversation working" })).toBeTruthy();
  expect(view.container.querySelector(".bot-main-activity .conversation-status-working")).toBeNull();
  expect(view.container.querySelector(".bot-main-activity .conversation-status-done")).not.toBeNull();
});

it.each([null, "missing"])("keeps other activity separate from an unavailable main (%s)", (mainThreadId) => {
  const view = render(<BotActivityBadge mainThreadId={mainThreadId} threads={[running("other")]} />);
  expect(view.getByRole("img", { name: "Main conversation unavailable; 1 other conversation working" })).toBeTruthy();
  expect(view.container.querySelector(".bot-main-activity")).toBeNull();
  expect(view.container.querySelector(".bot-main-activity-placeholder")).not.toBeNull();
});

it("bounds activity to three slots and exposes the exact overflow count", () => {
  const view = render(<BotActivityBadge mainThreadId="main" threads={[running("main"), ...Array.from({ length: 20 }, (_, i) => running(`other-${i}`))]} />);
  const badge = view.getByRole("img", { name: /20 other conversations working/ });
  expect(badge.getAttribute("title")).toContain("20 other conversations working");
  expect(badge.querySelectorAll(".bot-other-working-dot")).toHaveLength(2);
  expect(badge.querySelector(".bot-other-working-overflow")?.textContent).toBe("+");
});

it("counts each background-working conversation once, ignoring archived and waiting threads", () => {
  const background = thread("background", 10, { indicator: "unread-success", isUnread: true, activity: { workflows: 2, backgroundAgents: 5, backgroundCommands: 3, planMode: 0, goals: 0 } });
  const view = render(<BotActivityBadge mainThreadId="main" threads={[
    running("main"), background, { ...running("archived"), isArchived: true },
    { ...running("waiting"), hasPendingInteraction: true }, thread("waiting-indicator", 1, { indicator: "waiting-for-input" }),
  ]} />);
  expect(view.getByRole("img", { name: /1 other conversation working/ })).toBeTruthy();
  expect(view.container.querySelectorAll(".bot-other-working-dot")).toHaveLength(1);
  expect(view.container.querySelector(".bot-done-badge")).toBeNull();
});

it("keeps main waiting status distinct from working", () => {
  const view = render(<BotActivityBadge mainThreadId="main" threads={[{ ...running("main"), hasPendingInteraction: true }]} />);
  expect(view.getByRole("img", { name: "Main conversation: Waiting for input" })).toBeTruthy();
  expect(view.container.querySelector(".conversation-status-waiting")).not.toBeNull();
  expect(view.container.querySelector(".conversation-status-working")).toBeNull();
});

it("does not let unread completion hide ongoing activity, but retains unread errors", () => {
  const done = thread("done", 1, { indicator: "unread-success", isUnread: true });
  const view = render(<BotActivityBadge mainThreadId="main" threads={[running("main"), done]} />);
  expect(view.container.querySelector(".conversation-status-working")).not.toBeNull();
  expect(view.container.querySelector(".bot-done-badge")).toBeNull();
  view.rerender(<BotActivityBadge mainThreadId="main" threads={[running("main"), { ...done, indicator: "unread-error" }]} />);
  expect(view.getByRole("img", { name: "Finished conversation has an unread error" }).getAttribute("data-with-activity")).toBe("true");
  expect(view.container.querySelector(".conversation-status-working")).not.toBeNull();
});

it("removes activity when work finishes and keeps unread completion as a dot, not a check", () => {
  const view = render(<BotActivityBadge mainThreadId="main" threads={[running("main"), running("other")]} />);
  view.rerender(<BotActivityBadge mainThreadId="main" threads={[thread("main", 1, { indicator: "unread-success", isUnread: true })]} />);
  expect(view.container.querySelector(".bot-activity-badge")).toBeNull();
  const done = view.getByRole("img", { name: "Finished conversation is unread" });
  expect(done.querySelector("svg")).toBeNull();
  view.rerender(<BotActivityBadge mainThreadId="main" threads={[thread("main", 1)]} />);
  expect(view.container.childElementCount).toBe(0);
});

const app = await loadPluginApp(() => import("../app"));
it("shows collapsed activity at the avatar without mixing bot ownership or changing child disclosure", async () => {
  const onNavigate = vi.fn();
  const rows = [running("main"), { ...running("child"), parentThreadId: "main" }, running("topic"), running("second-topic"), running("another-bot"), running("unassigned")];
  const slot = renderSlot(app.threadLists[0]!, { activeThreadId: null, activeProjectId: "project", isCompactViewport: false, onNavigate, searchQuery: "", Original: () => null }, {
    sidebarThreads: { projects: [{ id: "project", name: "Shared project", isPersonal: false }], threads: rows },
    rpc: { bots_list: () => ({ bots: [bot, { ...bot, id: "other-bot", name: "Other bot", mainThreadId: "another-bot" }], hosts: [], sections: [], projects: [], personalProjectId, warnings: [], threadBindings: rows.filter(row => row.id !== "unassigned").map(row => ({ threadId: row.id, botId: row.id === "another-bot" ? "other-bot" : bot.id })) }) },
  });
  await slot.findByText(bot.name);
  const row = slot.getByText(bot.name).closest<HTMLElement>(".project-row")!;
  expect(within(row).getByRole("img", { name: "Main conversation: Working; 3 other conversations working" }).closest(".bot-icon-shell")).not.toBeNull();
  expect(slot.queryByText("Conversation child")).toBeNull();
  const disclosure = within(row).getByRole("button", { name: "Expand children of Test bot" });
  expect(disclosure.textContent).toBe("1");
  fireEvent.click(disclosure);
  expect(slot.getByText("Conversation child")).toBeTruthy();
  expect(slot.inspection.sidebarActionCalls).toEqual([]);
  expect(onNavigate).not.toHaveBeenCalled();
});
