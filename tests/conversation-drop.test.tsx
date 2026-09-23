// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { bot, personalProjectId, thread } from "./fixtures";

// The SDK test shim records "open" immediately on pointerdown; the real host
// only engages a split after leaving the sidebar. Keep its gesture hook wired
// without treating that shim shortcut as a real navigation during this test.
const split = vi.hoisted(() => ({ onPointerDown: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  return { ...sdk, experimental_useSidebarThreadSplit: () => ({ splitProps: { onPointerDown: split.onPointerDown }, isAvailable: true, layout: null }) };
});
const app = await loadPluginApp(() => import("../app"));
let hit: Element | null = null;
const originalHitTest = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
beforeEach(() => { split.onPointerDown.mockClear(); hit = null; Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => hit }); });
afterEach(() => { cleanup(); if (originalHitTest) Object.defineProperty(document, "elementFromPoint", originalHitTest); else Reflect.deleteProperty(document, "elementFromPoint"); });
async function mount(fail = false, afterAssignment?: () => Promise<void>) {
  let assigned = false;
  const bots = [{ ...bot, id: "atlas", name: "Atlas", mainThreadId: "main-a", linkedProjectIds: [], threadOrder: [] as string[] }, { ...bot, id: "nova", name: "Nova", mainThreadId: "main-b", linkedProjectIds: [], threadOrder: ["main-b"] }];
  const rows = [thread("main-a", 100), thread("main-b", 100), thread("chat", 90), thread("child", 80, { parentThreadId: "chat" }), thread("assigned-child", 70, { parentThreadId: "chat" })];
  const bindings = [{ threadId: "main-a", botId: "atlas" }, { threadId: "main-b", botId: "nova" }, { threadId: "assigned-child", botId: "atlas" }];
  const onNavigate = vi.fn();
  const slot = renderSlot(app.threadLists[0]!, { activeThreadId: "main-a", activeProjectId: "project", isCompactViewport: false, onNavigate, searchQuery: "", Original: () => null }, {
    sidebarThreads: { projects: [{ id: "project", name: "Work project", isPersonal: false }], threads: rows },
    rpc: {
      bots_list: async () => {
        if (assigned) await afterAssignment?.();
        return { bots, personalProjectId, hosts: [], sections: [], projects: [], warnings: [], threadBindings: [...bindings] };
      },
      conversation_assign: (value) => {
        if (fail) throw new Error("Assignment failed; try again");
        const { threadId, botId, placeFirst } = value as { threadId: string; botId: string; placeFirst?: boolean };
        bindings.push({ threadId, botId });
        assigned = true;
        const target = bots.find(bot => bot.id === botId)!;
        if (placeFirst) target.threadOrder = [threadId, ...target.threadOrder.filter(id => id !== threadId)];
        else if (placeFirst === false) target.threadOrder.push(threadId);
        return { ok: true };
      },
    },
  });
  await slot.findByText("Atlas");
  const source = slot.container.querySelector<HTMLElement>('[data-sidebar-thread-id="chat"]')!;
  const target = slot.container.querySelector<HTMLElement>('[data-bot-drop-target="nova"]')!;
  return { slot, source, target, bindings, onNavigate };
}
function down(source: HTMLElement, pointerType = "mouse") { fireEvent.pointerDown(source, { button: 0, buttons: 1, pointerId: 1, pointerType, clientX: 40, clientY: 300 }); }
function move(target: Element | null) { hit = target; fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 40, clientY: 100 }); }
function up(shiftKey = false) { fireEvent.pointerUp(window, { button: 0, buttons: 0, pointerId: 1, clientX: 40, clientY: 100, shiftKey }); }

it("drags a project-associated private chat onto a bot without prior membership or navigation", async () => {
  const { slot, source, target, bindings, onNavigate } = await mount();
  down(source); move(target);
  expect(target.getAttribute("data-conversation-drop")).toBe("true");
  expect(source.parentElement?.getAttribute("data-conversation-dragging")).toBe("true");
  expect(target.textContent).toContain("Add to end");
  expect(document.querySelector(".conversation-drag-ghost")).not.toBeNull();
  up(); fireEvent.click(target.querySelector("button")!);
  await waitFor(() => expect(bindings).toContainEqual({ threadId: "chat", botId: "nova" }));
  await waitFor(() => expect(slot.container.querySelector('.recent-row [data-sidebar-thread-id="chat"]')).toBeNull());
  expect(slot.inspection.rpcCalls.filter(call => call.method === "conversation_assign")).toEqual([{ method: "conversation_assign", input: { threadId: "chat", botId: "nova", placeFirst: false } }]);
  expect(slot.inspection.rpcCalls.some(call => call.method === "bots_reorder" || call.method === "main_set")).toBe(false);
  expect(slot.inspection.sidebarActionCalls).toEqual([]); expect(onNavigate).not.toHaveBeenCalled();
  expect(split.onPointerDown).toHaveBeenCalledOnce();
  expect(bindings.find(entry => entry.threadId === "assigned-child")?.botId).toBe("atlas");
  expect(document.querySelector(".conversation-drag-ghost")).toBeNull();
  await waitFor(() => expect(target.querySelector(".conversation-disclosure")?.getAttribute("aria-expanded")).toBe("true"));
  fireEvent.click(target.querySelector("button")!);
  expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "open", threadId: "main-b", options: undefined });
});

it("Shift promotes an outside drop and unfolds, updating the hint without pointer movement", async () => {
  const { slot, source, target } = await mount(); down(source); move(target);
  fireEvent.keyDown(document, { key: "Shift", shiftKey: true });
  expect(target.textContent).toContain("Make first");
  fireEvent.keyUp(document, { key: "Shift", shiftKey: false });
  expect(target.textContent).toContain("Add to end");
  fireEvent.keyDown(document, { key: "Shift", shiftKey: true }); up(true);
  await waitFor(() => expect(target.querySelector(".conversation-disclosure")?.getAttribute("aria-expanded")).toBe("true"));
  expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_assign", input: { threadId: "chat", botId: "nova", placeFirst: true } });
  fireEvent.click(target.querySelector("button")!);
  expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "open", threadId: "chat", options: undefined });
});

it("Escape cancels the drop and suppresses the eventual release click", async () => {
  const { slot, source, target, onNavigate } = await mount(); down(source); move(target);
  fireEvent.keyDown(document, { key: "Escape" }); expect(document.querySelector(".conversation-drag-ghost")).toBeNull();
  up(); fireEvent.click(target.querySelector("button")!);
  expect(slot.inspection.rpcCalls.some(call => call.method === "conversation_assign")).toBe(false);
  expect(slot.inspection.sidebarActionCalls).toEqual([]); expect(onNavigate).not.toHaveBeenCalled();
});

it("drops on the face to promote without Shift, switching feedback between both zones", async () => {
  const { slot, source, target } = await mount();
  const face = target.querySelector<HTMLElement>("[data-bot-drop-first]")!;
  const body = target.querySelector<HTMLElement>("[data-bot-drop-append]")!;
  down(source); move(face.firstElementChild ?? face);
  expect(face.dataset.dropActive).toBe("true");
  expect(target.textContent).toContain("Make first");
  move(body);
  expect(face.dataset.dropActive).toBe("false");
  expect(body.dataset.dropActive).toBe("true");
  expect(target.textContent).toContain("Add to end");
  move(face); up();
  await waitFor(() => expect(target.querySelector(".conversation-disclosure")?.getAttribute("aria-expanded")).toBe("true"));
  expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_assign", input: { threadId: "chat", botId: "nova", placeFirst: true } });
  expect(slot.inspection.sidebarActionCalls).toEqual([]);
});

it("does not change drop zones unseen at release", async () => {
  const { slot, source, target } = await mount(); down(source); move(target);
  hit = target.querySelector("[data-bot-drop-first]"); up();
  expect(slot.inspection.rpcCalls.some(call => call.method === "conversation_assign")).toBe(false);
});

it("unfolds immediately after append succeeds and reveals the added row after a delayed refresh", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
  try {
    const { slot, source, target } = await mount(false, () => gate);
    down(source); move(target); up();
    await waitFor(() => expect(target.querySelector(".conversation-disclosure")?.getAttribute("aria-expanded")).toBe("true"));
    expect(scroll).not.toHaveBeenCalledWith({ block: "nearest", inline: "nearest", behavior: "instant" });
    release();
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest", behavior: "instant" }));
    const added = target.closest(".project-group")!.querySelector('[data-sidebar-thread-id="chat"]');
    expect(added).not.toBeNull();
    expect(scroll.mock.contexts).toContain(added);
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
  } finally {
    release();
    if (original) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", original);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});

it("normal clicks still navigate, but touch scrolling never starts assignment dragging", async () => {
  const { slot, source, target } = await mount();
  down(source); hit = source; fireEvent.pointerUp(window, { pointerId: 1, clientX: 40, clientY: 300 }); fireEvent.click(source);
  expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "open", threadId: "chat", options: { split: false } });
  down(source, "touch"); move(target); up();
  expect(document.querySelector(".conversation-drag-ghost")).toBeNull();
  expect(slot.inspection.rpcCalls.some(call => call.method === "conversation_assign")).toBe(false);
});

it("dropping outside the bot rows does not assign or accept external targets", async () => {
  const { slot, source } = await mount();
  const external = document.createElement("div"); external.dataset.botDropTarget = "nova"; document.body.append(external);
  down(source); move(external); up(); external.remove();
  expect(slot.inspection.rpcCalls.some(call => call.method === "conversation_assign")).toBe(false);
});

it("does not assign to a different bot moved beneath the pointer after the last highlight", async () => {
  const { slot, source, target } = await mount(); down(source); move(target);
  hit = slot.container.querySelector('[data-bot-drop-target="atlas"]'); up();
  expect(slot.inspection.rpcCalls.some(call => call.method === "conversation_assign")).toBe(false);
});

it("keeps the chat in place and shows the server error on failure", async () => {
  const { slot, source, target } = await mount(true); down(source); move(target); up();
  expect((await slot.findByRole("alert")).textContent).toContain("Assignment failed");
  expect(slot.container.querySelector('.recent-row [data-sidebar-thread-id="chat"]')).not.toBeNull();
  expect(document.querySelector(".conversation-drag-ghost")).toBeNull();
});

it("cleans up listeners and the ghost on unmount", async () => {
  const { slot, source, target } = await mount(); down(source); move(target); slot.lifecycle.unmount(); up();
  expect(slot.inspection.rpcCalls.some(call => call.method === "conversation_assign")).toBe(false);
  expect(document.querySelector(".conversation-drag-ghost")).toBeNull();
});
