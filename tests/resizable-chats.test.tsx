// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ResizableChats } from "../components/resizable-chats";

beforeEach(() => localStorage.clear());
afterEach(cleanup);
const content = <div>A chat</div>;

it("collapses to the header, persists the choice, and restores its previous size", () => {
  const onNewChat = vi.fn();
  const view = render(<ResizableChats activeChatId={null} onNewChat={onNewChat}>{content}</ResizableChats>);
  const separator = view.getByRole("separator", { name: "Resize Chats" });
  fireEvent.keyDown(separator, { key: "ArrowUp" });
  expect(separator.getAttribute("aria-valuenow")).toBe("186");
  fireEvent.click(view.getByRole("button", { name: "Chats" }));
  expect(view.getByRole("button", { name: "Chats" }).getAttribute("aria-expanded")).toBe("false");
  expect(view.queryByText("A chat")).toBeNull();
  expect(view.queryByRole("separator")).toBeNull();
  view.unmount();
  const again = render(<ResizableChats activeChatId={null} onNewChat={onNewChat}>{content}</ResizableChats>);
  expect(again.queryByText("A chat")).toBeNull();
  fireEvent.click(again.getByRole("button", { name: "Chats" }));
  expect(again.getByRole("separator").getAttribute("aria-valuenow")).toBe("186");
  expect(again.getByText("A chat")).toBeTruthy();
});

it("resizes with pointer drag and clamps both ends", () => {
  const view = render(<ResizableChats activeChatId={null} onNewChat={() => {}}>{content}</ResizableChats>);
  const separator = view.getByRole("separator");
  Object.assign(separator, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
  fireEvent.pointerDown(separator, { pointerId: 1, clientY: 300, button: 0 });
  fireEvent.pointerMove(separator, { pointerId: 1, clientY: 200 });
  expect(separator.getAttribute("aria-valuenow")).toBe("270");
  fireEvent.pointerMove(separator, { pointerId: 1, clientY: -1000 });
  expect(separator.getAttribute("aria-valuenow")).toBe(separator.getAttribute("aria-valuemax"));
  fireEvent.pointerMove(separator, { pointerId: 1, clientY: 1000 });
  expect(separator.getAttribute("aria-valuenow")).toBe("80");
  fireEvent.pointerUp(separator, { pointerId: 1 });
  fireEvent.pointerMove(separator, { pointerId: 1, clientY: 200 });
  expect(separator.getAttribute("aria-valuenow")).toBe("80");
  expect(localStorage.getItem("bots:chats-height")).toBe("80");
});

it("reopens on navigation to another chat but allows deliberate collapse of the current one", () => {
  const view = render(<ResizableChats activeChatId="one" onNewChat={() => {}}>{content}</ResizableChats>);
  fireEvent.click(view.getByRole("button", { name: "Chats" }));
  view.rerender(<ResizableChats activeChatId="one" onNewChat={() => {}}>{content}</ResizableChats>);
  expect(view.queryByText("A chat")).toBeNull();
  view.rerender(<ResizableChats activeChatId="two" onNewChat={() => {}}>{content}</ResizableChats>);
  expect(view.getByText("A chat")).toBeTruthy();
});

it("keeps New chat accessible when collapsed", () => {
  const onNewChat = vi.fn();
  localStorage.setItem("bots:chats-collapsed", "true");
  const view = render(<ResizableChats activeChatId={null} onNewChat={onNewChat}>{content}</ResizableChats>);
  fireEvent.click(view.getByRole("button", { name: "New unconnected chat" }));
  expect(onNewChat).toHaveBeenCalledOnce();
  expect(view.getByText("A chat")).toBeTruthy();
});

it("ignores invalid persisted heights and supports keyboard bounds", () => {
  localStorage.setItem("bots:chats-height", "NaN");
  const view = render(<ResizableChats activeChatId={null} onNewChat={() => {}}>{content}</ResizableChats>);
  const separator = view.getByRole("separator");
  expect(separator.getAttribute("aria-valuenow")).toBe("170");
  fireEvent.keyDown(separator, { key: "Home" });
  expect(separator.getAttribute("aria-valuenow")).toBe("80");
  fireEvent.keyDown(separator, { key: "End" });
  expect(separator.getAttribute("aria-valuenow")).toBe(separator.getAttribute("aria-valuemax"));
});
