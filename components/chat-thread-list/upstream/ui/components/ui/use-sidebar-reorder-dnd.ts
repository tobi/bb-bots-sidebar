import { useCallback, useEffect, useRef } from "react";
import type {
  CollisionDetection,
  DragEndEvent,
  DragStartEvent,
  Sensor,
  TouchSensorOptions,
} from "@dnd-kit/core";
import {
  reorderCollisionDetection,
  useReorderDnd,
  type UseReorderDndArgs,
  type UseReorderDndResult,
} from "./use-reorder-dnd.js";
import { useChatScope } from "../../../../chat-scope";

function setSidebarDraggingCursor(active: boolean): void {
  if (active) {
    document.body.dataset.sidebarDragging = "true";
    return;
  }
  delete document.body.dataset.sidebarDragging;
}

type UseSidebarReorderDndArgs = UseReorderDndArgs & {
  touchSensor: Sensor<TouchSensorOptions>;
};

export function useSidebarReorderDnd({
  onDragEnd,
  onDragStart,
  onDragMove,
  onDragOver,
  onDragCancel,
  collisionDetection,
  axis,
  measuring,
  touchSensor,
}: UseSidebarReorderDndArgs): UseReorderDndResult {
  const isChatList = useChatScope() !== null;
  const pointerWithinChats = useRef(true);
  const detectCollisions = useCallback<CollisionDetection>((args) => {
    const point = args.pointerCoordinates;
    // Bots and Chats share the host sidebar. Only Chats owns native drops.
    pointerWithinChats.current = !isChatList || point === null || typeof document.elementsFromPoint !== "function" ||
      document.elementsFromPoint(point.x, point.y).some(element => element.closest(".chat-thread-list") !== null);
    if (!pointerWithinChats.current) return [];
    return (collisionDetection ?? reorderCollisionDetection)(args);
  }, [isChatList, collisionDetection]);
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      pointerWithinChats.current = true;
      setSidebarDraggingCursor(true);
      onDragStart?.(event);
    },
    [onDragStart],
  );
  const handleDragCancel = useCallback(() => {
    setSidebarDraggingCursor(false);
    onDragCancel?.();
  }, [onDragCancel]);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setSidebarDraggingCursor(false);
      // A retained native target must not commit after assignment takes over.
      if (pointerWithinChats.current) onDragEnd(event);
      else onDragCancel?.();
    },
    [onDragEnd, onDragCancel],
  );

  useEffect(() => {
    return () => {
      setSidebarDraggingCursor(false);
    };
  }, []);

  return useReorderDnd({
    onDragEnd: handleDragEnd,
    onDragStart: handleDragStart,
    onDragMove,
    onDragOver,
    onDragCancel: handleDragCancel,
    collisionDetection: detectCollisions,
    touchSensor,
    axis,
    measuring,
  });
}
