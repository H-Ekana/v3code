import * as Schema from "effect/Schema";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
  useState,
} from "react";

import { getLocalStorageItem, setLocalStorageItem } from "./useLocalStorage";

const WidthSchema = Schema.Finite;
const DEFAULT_KEYBOARD_STEP = 8;
const DEFAULT_KEYBOARD_LARGE_STEP = 32;

export interface UseResizableWidthOptions {
  /** localStorage key the persisted width is stored under. */
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  /**
   * Which edge of the host element carries the drag handle:
   *   - "left"  → panel grows leftward (right-anchored panels)
   *   - "right" → panel grows rightward (left-anchored panels)
   */
  readonly edge: "left" | "right";
  /** Width change, in pixels, for an unmodified arrow-key press. */
  readonly keyboardStep?: number;
  /** Width change, in pixels, while Shift is held. */
  readonly keyboardLargeStep?: number;
}

export interface ResizableWidthHandlers {
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

export interface ResizableWidthSeparatorProps {
  readonly role: "separator";
  readonly tabIndex: 0;
  readonly "aria-orientation": "vertical";
  readonly "aria-valuemin": number;
  readonly "aria-valuemax": number;
  readonly "aria-valuenow": number;
}

export interface KeyboardResizeInput {
  readonly currentWidth: number;
  readonly key: string;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly step?: number;
  readonly largeStep?: number;
  readonly useLargeStep?: boolean;
}

/**
 * Resolve the width requested by a resize-handle key press. Returning `null`
 * lets consumers distinguish unrelated keys without duplicating the mapping.
 */
export function getKeyboardResizedWidth(input: KeyboardResizeInput): number | null {
  const step = input.useLargeStep
    ? (input.largeStep ?? DEFAULT_KEYBOARD_LARGE_STEP)
    : (input.step ?? DEFAULT_KEYBOARD_STEP);
  const clamp = (value: number) => Math.max(input.minWidth, Math.min(input.maxWidth, value));

  switch (input.key) {
    case "ArrowLeft":
    case "ArrowUp":
      return clamp(input.currentWidth - step);
    case "ArrowRight":
    case "ArrowDown":
      return clamp(input.currentWidth + step);
    case "Home":
      return input.minWidth;
    case "End":
      return input.maxWidth;
    default:
      return null;
  }
}

/**
 * Width state for a side-anchored panel resized via a drag handle on the
 * specified edge. Width is read from localStorage on mount and persisted on
 * drag-end (not on every rAF tick — would otherwise be ~60 writes/sec).
 *
 * The hook updates an internal `width` state during drag (so the panel
 * follows the cursor live) and only commits to localStorage when the user
 * lifts the pointer.
 */
export function useResizableWidth(options: UseResizableWidthOptions): {
  readonly width: number;
  readonly isResizing: boolean;
  readonly handlers: ResizableWidthHandlers;
  readonly separatorProps: ResizableWidthSeparatorProps;
} {
  const {
    storageKey,
    defaultWidth,
    minWidth,
    maxWidth,
    edge,
    keyboardStep = DEFAULT_KEYBOARD_STEP,
    keyboardLargeStep = DEFAULT_KEYBOARD_LARGE_STEP,
  } = options;

  const clamp = useCallback(
    (value: number): number => {
      if (!Number.isFinite(value)) return defaultWidth;
      return Math.max(minWidth, Math.min(maxWidth, value));
    },
    [defaultWidth, maxWidth, minWidth],
  );

  // No cross-tab subscription: panel width is per-window state.
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return defaultWidth;
    try {
      const stored = getLocalStorageItem(storageKey, WidthSchema);
      return clamp(stored ?? defaultWidth);
    } catch (error) {
      console.error("Could not read persisted panel width.", error);
      return defaultWidth;
    }
  });
  const [isResizing, setIsResizing] = useState(false);

  const clampedWidth = clamp(width);

  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    pending: number;
    rafId: number | null;
    target: HTMLElement;
  } | null>(null);

  const releasePointer = useCallback((pointerId: number) => {
    const state = dragStateRef.current;
    if (!state) return;
    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
    }
    try {
      if (state.target.hasPointerCapture(pointerId)) {
        state.target.releasePointerCapture(pointerId);
      }
    } catch {
      // pointer may already be released; harmless.
    }
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    dragStateRef.current = null;
    setIsResizing(false);
  }, []);

  const persistWidth = useCallback(
    (nextWidth: number) => {
      try {
        setLocalStorageItem(storageKey, nextWidth, WidthSchema);
      } catch (error) {
        console.error("Could not persist panel width.", error);
      }
    },
    [storageKey],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        return;
      }
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: clampedWidth,
        pending: clampedWidth,
        rafId: null,
        target,
      };
      setIsResizing(true);
    },
    [clampedWidth],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      event.preventDefault();
      const delta = edge === "left" ? state.startX - event.clientX : event.clientX - state.startX;
      state.pending = clamp(state.startWidth + delta);
      if (state.rafId !== null) return;
      state.rafId = requestAnimationFrame(() => {
        const active = dragStateRef.current;
        if (!active) return;
        active.rafId = null;
        setWidth(active.pending);
      });
    },
    [clamp, edge],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const finalWidth = clamp(state.pending);
      releasePointer(event.pointerId);
      // Commit once at drag-end to avoid 60Hz localStorage writes.
      persistWidth(finalWidth);
      setWidth(finalWidth);
    },
    [clamp, persistWidth, releasePointer],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      // Don't persist a cancelled drag; revert to the start width.
      releasePointer(event.pointerId);
      setWidth(state.startWidth);
    },
    [releasePointer],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const nextWidth = getKeyboardResizedWidth({
        currentWidth: clampedWidth,
        key: event.key,
        minWidth,
        maxWidth,
        step: keyboardStep,
        largeStep: keyboardLargeStep,
        useLargeStep: event.shiftKey,
      });
      if (nextWidth === null) return;

      event.preventDefault();
      event.stopPropagation();
      setWidth(nextWidth);
      persistWidth(nextWidth);
    },
    [clampedWidth, keyboardLargeStep, keyboardStep, maxWidth, minWidth, persistWidth],
  );

  return {
    width: clampedWidth,
    isResizing,
    handlers: { onKeyDown, onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    separatorProps: {
      role: "separator",
      tabIndex: 0,
      "aria-orientation": "vertical",
      "aria-valuemin": minWidth,
      "aria-valuemax": maxWidth,
      "aria-valuenow": clampedWidth,
    },
  };
}
