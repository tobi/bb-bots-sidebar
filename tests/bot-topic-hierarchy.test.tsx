// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { bot, personalProjectId, thread } from "./fixtures";

const split = vi.hoisted(() => ({ onPointerDown: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", async importOriginal => {
  const sdk = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  return { ...sdk, experimental_useSidebarThreadSplit: () => ({ splitProps: { onPointerDown: split.onPointerDown }, isAvailable: true, layout: null }) };
});
const app = await loadPluginApp(() => import("../app"));
const Sidebar = app.threadLists[0]!.component;
let hit: Element | null = null;
const originalHitTest = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
beforeEach(() => { hit = null; split.onPointerDown.mockClear(); Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => hit }); });
afterEach(() => { cleanup(); if (originalHitTest) Object.defineProperty(document, "elementFromPoint", originalHitTest); else Reflect.deleteProperty(document, "elementFromPoint"); });

async function mount(fail = false) {
  const metadata = { ...bot, threadOrder: ["first", "main", "last"] };
  const rows = [thread("main", 1000), thread("first", 20), thread("last", 10),
    thread("child", 30, { parentThreadId: "main" }), thread("grandchild", 40, { parentThreadId: "child" })];
  function Host() {
    const [activeThreadId, setActive] = useState<string | null>(null);
    return <><button onClick={() => setActive("grandchild")}>Go grandchild</button><button onClick={() => setActive(null)}>Go elsewhere</button>
      <Sidebar activeThreadId={activeThreadId} activeProjectId="project" isCompactViewport={false} onNavigate={() => {}} searchQuery="" Original={() => null} /></>;
  }
  const slot = renderSlot({ component: Host }, {}, {
    sidebarThreads: { projects: [{ id: "project", name: "Project", isPersonal: false }], threads: rows },
    rpc: {
      bots_list: () => ({ personalProjectId, bots: [{ ...metadata }], sections: [], hosts: [], projects: [], warnings: [], threadBindings: rows.filter(row => !row.parentThreadId).map(row => ({ threadId: row.id, botId: bot.id })) }),
      conversation_reorder: (input) => {
        if (fail) throw new Error("Reorder failed");
        const { threadId, targetThreadId, position } = input as { threadId: string; targetThreadId: string; position: string };
        const order = metadata.threadOrder.filter(id => id !== threadId);
        order.splice(order.indexOf(targetThreadId) + Number(position === "after"), 0, threadId);
        metadata.threadOrder = order; return { ok: true };
      },
      conversation_nest: () => ({ ok: true }),
    },
  });
  const botRow = (await slot.findByText(bot.name)).closest<HTMLElement>(".project-row")!;
  const toggle = () => within(botRow).getByRole("button", { name: /conversations for Test bot/ });
  const open = () => within(botRow).getByRole("button", { name: /^Test bot/ });
  return { slot, botRow, toggle, open };
}

it("opens the first ordered conversation without unfolding, not the legacy main", async () => {
  const { slot, botRow, toggle, open } = await mount();
  expect(botRow.lastElementChild).toBe(toggle()); expect(toggle().textContent?.trim()).toBe("3");
  fireEvent.click(open());
  expect(slot.inspection.sidebarActionCalls).toEqual([{ method: "open", threadId: "first", options: undefined }]);
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
  expect(slot.queryByRole("group", { name: "Conversations for Test bot" })).toBeNull();
  fireEvent.click(toggle());
  expect(Array.from(slot.container.querySelectorAll('[data-sidebar-thread-id]')).map(row => row.getAttribute("data-sidebar-thread-id"))).toEqual(["first", "main", "last"]);
  fireEvent.click(open()); expect(toggle().getAttribute("aria-expanded")).toBe("true");
});

it("double-clicking the bot toggles the list once, without duplicate navigation", async () => {
  const { slot, toggle, open } = await mount();
  for (const expanded of ["true", "false"]) {
    const button = open();
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(button, { detail: 2 });
    fireEvent.doubleClick(button, { detail: 2 });
    expect(toggle().getAttribute("aria-expanded")).toBe(expanded);
    expect(slot.queryByText("Conversation child")).toBeNull();
  }
  expect(slot.inspection.sidebarActionCalls).toEqual([
    { method: "open", threadId: "first", options: undefined },
    { method: "open", threadId: "first", options: undefined },
  ]);
  fireEvent.doubleClick(toggle());
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
  expect(slot.inspection.rpcCalls.every(call => call.method === "bots_list")).toBe(true);
});

it.each(["before", "after", "nest", "escape", "outside", "touch", "blur", "unmount", "failure"])("pointer drag supports %s without stealing split gestures or clicks", async mode => {
  const { slot, toggle } = await mount(mode === "failure"); fireEvent.click(toggle());
  const source = slot.container.querySelector<HTMLElement>('[data-sidebar-thread-id="last"]')!;
  const target = slot.container.querySelector<HTMLElement>('[data-sidebar-thread-id="first"]')!;
  vi.spyOn(target.closest(".thread-row")!, "getBoundingClientRect").mockReturnValue({ top: 80, height: 40 } as DOMRect);
  fireEvent.pointerDown(source, { button: 0, buttons: 1, pointerId: 1, pointerType: mode === "touch" ? "touch" : "mouse", clientX: 40, clientY: 300 });
  hit = mode === "outside" ? document.body : target;
  const clientY = mode === "after" ? 110 : 90;
  const shiftKey = mode === "nest";
  fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 40, clientY, shiftKey });
  if (["before", "after", "nest", "failure"].includes(mode)) expect(target.closest("li")?.dataset.dropPosition).toBe(shiftKey ? "inside" : mode === "after" ? "after" : "before");
  if (mode === "escape") fireEvent.keyDown(document, { key: "Escape" });
  if (mode === "blur") fireEvent(window, new Event("blur"));
  if (mode === "unmount") slot.lifecycle.unmount();
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 40, clientY, shiftKey });
  if (["before", "after", "nest", "escape", "outside"].includes(mode)) fireEvent.click(target);
  if (["before", "after", "failure"].includes(mode)) {
    await waitFor(() => expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_reorder", input: { botId: bot.id, threadId: "last", targetThreadId: "first", position: mode === "after" ? "after" : "before" } }));
  } else if (mode === "nest") {
    await waitFor(() => expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_nest", input: { threadId: "last", parentThreadId: "first" } }));
  } else expect(slot.inspection.rpcCalls.every(call => call.method === "bots_list")).toBe(true);
  if (mode === "failure") { expect(await slot.findByRole("alert")).toHaveProperty("textContent", "Reorder failed"); expect(slot.container.querySelector('[data-sidebar-thread-id]')?.getAttribute("data-sidebar-thread-id")).toBe("first"); }
  expect(split.onPointerDown).toHaveBeenCalledOnce(); expect(slot.inspection.sidebarActionCalls).toEqual([]);
  expect(document.querySelector(".conversation-drag-ghost")).toBeNull();
});

it("keeps the bot collapsed through navigation and reveals ancestor branches only after expansion", async () => {
  const { slot, toggle } = await mount();
  fireEvent.click(slot.getByText("Go grandchild"));
  expect(toggle().getAttribute("aria-expanded")).toBe("false"); expect(slot.queryByText("Conversation grandchild")).toBeNull();
  fireEvent.click(toggle()); expect(await slot.findByText("Conversation grandchild")).toBeTruthy();
  expect(slot.container.querySelector('[data-sidebar-thread-id="grandchild"]')?.getAttribute("aria-current")).toBe("page");
  fireEvent.click(slot.getByText("Go elsewhere")); expect(toggle().getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(toggle()); fireEvent.click(slot.getByText("Go grandchild")); expect(toggle().getAttribute("aria-expanded")).toBe("false");
});

it("treats the old main as an ordinary root with independently collapsed children", async () => {
  const { slot, toggle } = await mount(); fireEvent.click(toggle());
  expect(slot.queryByText("Conversation child")).toBeNull();
  fireEvent.click(slot.getByRole("button", { name: "Expand children of Conversation main" }));
  expect(slot.getByText("Conversation child")).toBeTruthy(); expect(slot.queryByText("Conversation grandchild")).toBeNull();
  fireEvent.contextMenu(slot.getByText("Conversation main"));
  expect(slot.queryByRole("menuitem", { name: /main conversation/ })).toBeNull(); expect(slot.getByRole("menuitem", { name: "Move to top" })).toBeTruthy();
});

it.each(["before", "after"])("dragging %s persists order without nesting or navigation", async position => {
  const { slot, toggle, open } = await mount(); fireEvent.click(toggle());
  const target = slot.container.querySelector<HTMLElement>('[data-thread-drop-target="first"]')!;
  vi.spyOn(target.querySelector(".thread-row")!, "getBoundingClientRect").mockReturnValue({ top: 10, height: 20 } as DOMRect);
  const data = new Map<string, string>();
  const dataTransfer = { types: ["application/x-bb-thread-id"], effectAllowed: "", setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? "" };
  fireEvent.dragStart(slot.getByText("Conversation last").closest(".thread-row")!, { dataTransfer });
  const clientY = position === "before" ? 12 : 28;
  const dragEvent = (name: string) => {
    const event = new MouseEvent(name, { bubbles: true, cancelable: true, clientY });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer }); return event;
  };
  fireEvent(target, dragEvent("dragover")); expect(target.dataset.dropPosition).toBe(position);
  fireEvent(target, dragEvent("drop"));
  await waitFor(() => expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_reorder", input: { botId: bot.id, threadId: "last", targetThreadId: "first", position } }));
  const expected = position === "before" ? ["last", "first", "main"] : ["first", "last", "main"];
  await waitFor(() => expect(Array.from(slot.container.querySelectorAll('[data-sidebar-thread-id]')).map(row => row.getAttribute("data-sidebar-thread-id"))).toEqual(expected));
  expect(slot.inspection.sidebarActionCalls).toEqual([]); expect(slot.inspection.rpcCalls.some(call => call.method === "conversation_nest" || call.method === "bots_reorder")).toBe(false);
  fireEvent.click(open()); expect(slot.inspection.sidebarActionCalls[0]).toMatchObject({ threadId: expected[0] });
});

it("drops an existing root on its own bot to make it first without navigation or collapse", async () => {
  const { slot, botRow, toggle } = await mount(); fireEvent.click(toggle());
  const source = slot.container.querySelector<HTMLElement>('[data-sidebar-thread-id="last"]')!;
  fireEvent.pointerDown(source, { button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", clientX: 40, clientY: 300 });
  hit = botRow;
  fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 40, clientY: 100 });
  expect(botRow.dataset.conversationDrop).toBe("true");
  expect(slot.getByText("Drop to make top conversation")).toBeTruthy();
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 40, clientY: 100 });
  fireEvent.click(within(botRow).getByRole("button", { name: /^Test bot/ }));
  await waitFor(() => expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_reorder", input: { botId: bot.id, threadId: "last", targetThreadId: "first", position: "before" } }));
  await waitFor(() => expect(slot.container.querySelector('[data-sidebar-thread-id]')?.getAttribute("data-sidebar-thread-id")).toBe("last"));
  expect(toggle().getAttribute("aria-expanded")).toBe("true"); expect(slot.inspection.sidebarActionCalls).toEqual([]);
});

it("archives the first row and opens the next without replacing a main", async () => {
  const { slot, toggle, open } = await mount(); fireEvent.click(toggle());
  fireEvent.click(slot.getByRole("button", { name: "Archive Conversation first" })); fireEvent.click(open());
  expect(slot.inspection.sidebarActionCalls).toEqual([{ method: "archive", threadId: "first" }, { method: "open", threadId: "main", options: undefined }]);
  expect(slot.inspection.rpcCalls.every(call => call.method === "bots_list")).toBe(true);
});
