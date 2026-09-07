// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ConversationStatusIcon } from "../components/conversation-status-icon";
import { thread } from "./fixtures";

afterEach(cleanup);

it.each(["runtime", "workflow", "background-agent", "background-command", "plan-mode", "goal", "working-draft"] as const)("shows working for %s", (indicator) => {
  const view = render(<ConversationStatusIcon thread={thread("test", 1, { indicator })} />);
  expect(view.getByRole("img", { name: "Working" }).classList.contains("conversation-status-working")).toBe(true);
});

it.each(["workflows", "backgroundAgents", "backgroundCommands", "planMode", "goals"] as const)("keeps %s work visible even with an unread foreground result", (field) => {
  const row = thread("test", 1, { indicator: "unread-success", isUnread: true });
  row.activity[field] = 1;
  const view = render(<ConversationStatusIcon thread={row} />);
  expect(view.getByRole("img", { name: "Working — unread" })).toBeTruthy();
});

it("switches from a spinner to an unread dot, then a smaller read dot", () => {
  const view = render(<ConversationStatusIcon thread={thread("test", 1, { indicator: "runtime" })} />);
  expect(view.getByRole("img", { name: "Working" })).toBeTruthy();
  view.rerender(<ConversationStatusIcon thread={thread("test", 2, { indicator: "unread-success", isUnread: true })} />);
  const unread = view.getByRole("img", { name: "Done — unread" });
  expect(unread.classList.contains("conversation-status-done")).toBe(true);
  expect(unread.getAttribute("data-unread")).toBe("true");
  expect(unread.querySelector("circle")?.getAttribute("r")).toBe("3");
  expect(unread.querySelector("path")).toBeNull();
  view.rerender(<ConversationStatusIcon thread={thread("test", 2)} />);
  const read = view.getByRole("img", { name: "Done" });
  expect(read.getAttribute("data-unread")).toBe("false");
  expect(read.querySelector("circle")?.getAttribute("r")).toBe("2");
  expect(view.container.querySelector(".conversation-status-working")).toBeNull();
});

it("distinguishes failed completion", () => {
  const view = render(<ConversationStatusIcon thread={thread("test", 1, { indicator: "unread-error", isUnread: true })} />);
  expect(view.getByRole("img", { name: "Finished with an error — unread" }).classList.contains("conversation-status-error")).toBe(true);
});

it.each([
  { indicator: "waiting-for-input" as const },
  { indicator: "runtime" as const, hasPendingInteraction: true },
])("prioritizes waiting for input over working: %j", (overrides) => {
  const view = render(<ConversationStatusIcon thread={thread("test", 1, overrides)} />);
  expect(view.getByRole("img", { name: "Waiting for input" })).toBeTruthy();
  expect(view.container.querySelector(".conversation-status-working")).toBeNull();
});

it("does not claim draft or unknown states are completed", () => {
  const row = thread("test", 1, { indicator: "draft" });
  const view = render(<ConversationStatusIcon thread={row} />);
  expect(view.getByRole("img", { name: "Draft" })).toBeTruthy();
  view.rerender(<ConversationStatusIcon thread={{ ...row, indicator: "future-state" as typeof row.indicator }} />);
  expect(view.getByRole("img", { name: "Conversation status unavailable" })).toBeTruthy();
  expect(view.container.querySelector(".conversation-status-done")).toBeNull();
});
