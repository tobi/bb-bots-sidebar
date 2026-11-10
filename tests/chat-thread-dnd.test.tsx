// @vitest-environment jsdom
import { act, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CollisionDetection, DragEndEvent } from "@dnd-kit/core";
import { renderSlot } from "./sidebar-host";
import { ChatScopeContext, type ChatScope } from "../components/chat-thread-list/chat-scope";
import { useSectionThreadDnd, type SectionThreadDndState } from "../components/chat-thread-list/upstream/app/dnd/useSectionThreadDnd";
import { buildSectionThreadList, CHRONOLOGICAL_CONTAINER_ID } from "../components/chat-thread-list/upstream/app/model/project-thread-groups";
import { thread } from "./fixtures";

const originalHitTest = Object.getOwnPropertyDescriptor(document, "elementsFromPoint");
afterEach(() => {
  cleanup();
  if (originalHitTest) Object.defineProperty(document, "elementsFromPoint", originalHitTest);
  else Reflect.deleteProperty(document, "elementsFromPoint");
});

function mount() {
  const rootItems = buildSectionThreadList([
    thread("dragged", 10, { sectionId: "a" }), thread("peer", 9, { sectionId: "b" }),
  ], undefined, [{ id: "a", name: "Section A" }, { id: "b", name: "Section B" }]);
  let current: SectionThreadDndState | null = null;
  const scope: ChatScope = { bindings: [], detached: new Set(), ready: true, onAssign: vi.fn(), onPointerDown: vi.fn() };
  function NativeList() {
    current = useSectionThreadDnd({ containerId: CHRONOLOGICAL_CONTAINER_ID, enabled: true, rootItems,
      topLevelSectionOrder: ["section:a", "section:b", "threads"], onTopLevelSectionOrderChange: vi.fn(),
      pinnedReorderPending: false, pinnedThreads: [], pinnedRootItems: [], pinnedRootNodes: [], onReorderPinnedThread: vi.fn() });
    return <div className="chat-thread-list"><div data-native-target="" /></div>;
  }
  function Host() {
    return <ChatScopeContext.Provider value={scope}><div data-sidebar="sidebar"><div className="bots-sidebar">
      <div data-bot-drop-target="bot">Bot</div><NativeList />
    </div></div></ChatScopeContext.Provider>;
  }
  const slot = renderSlot({ component: Host }, {});
  const botRow = slot.container.querySelector("[data-bot-drop-target]")!;
  const chatRow = slot.container.querySelector("[data-native-target]")!;
  let hit = chatRow;
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [hit] });
  const props = () => current!.dndContextProps;
  const targetRect = { top: 300, left: 0, width: 200, height: 28, right: 200, bottom: 328 };
  const event = (overId: string | null): DragEndEvent => ({
    active: { id: "dragged", data: { current: {} }, rect: { current: { initial: null, translated: null } } },
    activatorEvent: new MouseEvent("mousedown"),
    over: overId ? { id: overId, rect: targetRect, data: { current: {} }, disabled: false } : null,
    collisions: null, delta: { x: 0, y: 0 },
  });
  function hover(area: "bot" | "chat" | "keyboard") {
    hit = area === "bot" ? botRow : chatRow;
    const y = area === "bot" ? 80 : 314;
    const dragRect = { ...targetRect, top: y - 14, bottom: y + 14 };
    const collisions = props().collisionDetection!({ active: { id: "dragged" }, collisionRect: dragRect,
      droppableRects: new Map([["section:b", targetRect]]), droppableContainers: [{ id: "section:b" }],
      pointerCoordinates: area === "keyboard" ? null : { x: 40, y } } as unknown as Parameters<CollisionDetection>[0]);
    act(() => props().onDragOver?.(event(typeof collisions[0]?.id === "string" ? collisions[0].id : null)));
    return collisions;
  }
  act(() => props().onDragStart?.(event(null)));
  return { slot, hover, async drop(overId: string | null = "section:b") {
    act(() => props().onDragEnd?.(event(overId)));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  } };
}

it("cancels native section moves over a bot, including a stale native drop target", async () => {
  const { slot, hover, drop } = mount();
  expect(hover("chat").map(({ id }) => id)).toEqual(["section:b"]);
  expect(hover("bot")).toEqual([]);
  await drop();
  expect(slot.inspection.sdkCalls).toEqual([]);
});

it("resumes native moves when the pointer returns from Bots to Chats", async () => {
  const { slot, hover, drop } = mount();
  expect(hover("bot")).toEqual([]);
  expect(hover("chat").map(({ id }) => id)).toEqual(["section:b"]);
  await drop();
  expect(slot.inspection.sdkCalls).toEqual([{ method: "threads.update", args: [{ threadId: "dragged", sectionId: "b" }] }]);
});

it("keeps native keyboard section moves available", async () => {
  const { slot, hover, drop } = mount();
  expect(hover("keyboard").map(({ id }) => id)).toEqual(["section:b"]);
  await drop();
  expect(slot.inspection.sdkCalls).toEqual([{ method: "threads.update", args: [{ threadId: "dragged", sectionId: "b" }] }]);
});
