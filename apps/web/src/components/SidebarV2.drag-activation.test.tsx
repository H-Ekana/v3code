// @vitest-environment happy-dom
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragStartEvent,
} from "@dnd-kit/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SIDEBAR_THREAD_DRAG_ACTIVATION_CONSTRAINT } from "./Sidebar.logic";

function DraggableThread() {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: "thread" });
  return (
    <button ref={setNodeRef} type="button" {...attributes} {...listeners}>
      Thread
    </button>
  );
}

function DragHarness(props: { onDragStart: (event: DragStartEvent) => void }) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: SIDEBAR_THREAD_DRAG_ACTIVATION_CONSTRAINT,
    }),
  );
  return (
    <DndContext sensors={sensors} onDragStart={props.onDragStart}>
      <DraggableThread />
    </DndContext>
  );
}

function dispatchPointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: 0,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
    }),
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderHarness(onDragStart: (event: DragStartEvent) => void): HTMLButtonElement {
  act(() => root.render(<DragHarness onDragStart={onDragStart} />));
  const button = container.querySelector("button");
  if (!button) throw new Error("Expected draggable thread");
  return button;
}

describe("Sidebar V2 thread drag activation", () => {
  it("starts immediately when pointer travel passes the click guard", () => {
    const onDragStart = vi.fn();
    const thread = renderHarness(onDragStart);

    act(() => dispatchPointer(thread, "pointerdown", 0));
    act(() => dispatchPointer(document, "pointermove", 5));
    expect(onDragStart).not.toHaveBeenCalled();

    act(() => dispatchPointer(document, "pointermove", 7));
    expect(onDragStart).toHaveBeenCalledTimes(1);
    act(() => dispatchPointer(document, "pointerup", 7));
  });

  it("keeps a stationary pointer gesture as a click", () => {
    const onDragStart = vi.fn();
    const thread = renderHarness(onDragStart);

    act(() => dispatchPointer(thread, "pointerdown", 0));
    act(() => dispatchPointer(document, "pointerup", 0));

    expect(onDragStart).not.toHaveBeenCalled();
  });
});
