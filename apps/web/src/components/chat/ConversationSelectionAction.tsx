import { MessageSquarePlus } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ConversationReferenceSelection } from "~/conversationReference";
import { chatMarkdownClipboardPayload } from "~/markdown-clipboard";

interface ConversationSelectionActionProps {
  rootElement: HTMLElement | null;
  onAddReference: (selection: ConversationReferenceSelection) => boolean;
}

interface SelectionActionState extends ConversationReferenceSelection {
  readonly columnRect: DOMRect;
  readonly conversationRect: DOMRect;
  readonly cursorX: number;
  readonly rect: DOMRect;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface SelectionState {
  readonly isCollapsed: boolean;
  readonly rangeCount: number;
  getRangeAt(index: number): Range;
}

interface ScopedConversationSelection {
  readonly range: Range;
  readonly scope: HTMLElement;
}

const VIEWPORT_GUTTER = 12;
const SELECTION_ACTION_COLUMN_GAP = 8;
export const CONVERSATION_SELECTION_SETTLE_MS = 90;

export function conversationSelectionChangeAction(input: {
  hasSelection: boolean;
  isPointerSelecting: boolean;
}): "hide" | "wait" | "schedule" {
  if (!input.hasSelection) return "hide";
  return input.isPointerSelecting ? "wait" : "schedule";
}

function rangeRect(range: Range): DOMRect | null {
  if (!range || range.collapsed) return null;
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return rect;
  return range.getClientRects().item(0);
}

function clipRangeToScope(range: Range, scope: HTMLElement): Range | null {
  if (!range.intersectsNode(scope)) return null;
  const scopeRange = scope.ownerDocument.createRange();
  scopeRange.selectNodeContents(scope);
  const clippedRange = range.cloneRange();
  if (clippedRange.compareBoundaryPoints(Range.START_TO_START, scopeRange) < 0) {
    clippedRange.setStart(scopeRange.startContainer, scopeRange.startOffset);
  }
  if (clippedRange.compareBoundaryPoints(Range.END_TO_END, scopeRange) > 0) {
    clippedRange.setEnd(scopeRange.endContainer, scopeRange.endOffset);
  }
  return clippedRange.collapsed || clippedRange.toString().trim().length === 0
    ? null
    : clippedRange;
}

export function resolveScopedConversationSelection(
  rootElement: HTMLElement,
  selection: SelectionState | null,
): ScopedConversationSelection | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const matches: ScopedConversationSelection[] = [];
  for (const scope of rootElement.querySelectorAll<HTMLElement>(
    "[data-conversation-selectable-text]",
  )) {
    const clippedRange = clipRangeToScope(range, scope);
    if (!clippedRange) continue;
    matches.push({ range: clippedRange, scope });
    if (matches.length > 1) return null;
  }
  return matches[0] ?? null;
}

export function clampSelectionActionPosition(input: {
  selectionRect: Pick<DOMRect, "left" | "top" | "width" | "height">;
  columnRect: Pick<DOMRect, "left" | "right">;
  conversationRect: Pick<DOMRect, "left" | "right">;
  cursorX: number;
  popupWidth: number;
  popupHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): Point {
  const halfWidth = input.popupWidth / 2;
  const conversationLeft = Math.max(VIEWPORT_GUTTER, input.conversationRect.left + VIEWPORT_GUTTER);
  const conversationRight = Math.min(
    input.viewportWidth - VIEWPORT_GUTTER,
    input.conversationRect.right - VIEWPORT_GUTTER,
  );
  const leftSpace = input.columnRect.left - conversationLeft;
  const rightSpace = conversationRight - input.columnRect.right;
  const requiredSpace = input.popupWidth + SELECTION_ACTION_COLUMN_GAP;
  const distanceToLeft = Math.abs(input.cursorX - input.columnRect.left);
  const distanceToRight = Math.abs(input.columnRect.right - input.cursorX);
  const preferredSide = distanceToLeft <= distanceToRight ? "left" : "right";
  const alternateSide = preferredSide === "left" ? "right" : "left";
  const preferredSideFits =
    preferredSide === "left" ? leftSpace >= requiredSpace : rightSpace >= requiredSpace;
  const alternateSideFits =
    alternateSide === "left" ? leftSpace >= requiredSpace : rightSpace >= requiredSpace;
  const side = preferredSideFits ? preferredSide : alternateSideFits ? alternateSide : null;
  if (!side) {
    const x = Math.min(
      conversationRight - halfWidth,
      Math.max(conversationLeft + halfWidth, input.cursorX),
    );
    const preferredY = input.selectionRect.top - SELECTION_ACTION_COLUMN_GAP - input.popupHeight;
    const fallbackY =
      input.selectionRect.top + input.selectionRect.height + SELECTION_ACTION_COLUMN_GAP;
    const y = Math.min(
      input.viewportHeight - VIEWPORT_GUTTER - input.popupHeight,
      Math.max(VIEWPORT_GUTTER, preferredY >= VIEWPORT_GUTTER ? preferredY : fallbackY),
    );
    return { x, y };
  }

  const preferredX =
    side === "left"
      ? input.columnRect.left - SELECTION_ACTION_COLUMN_GAP - halfWidth
      : input.columnRect.right + SELECTION_ACTION_COLUMN_GAP + halfWidth;
  const x = Math.min(
    conversationRight - halfWidth,
    Math.max(conversationLeft + halfWidth, preferredX),
  );
  const y = Math.min(
    input.viewportHeight - VIEWPORT_GUTTER - input.popupHeight,
    Math.max(VIEWPORT_GUTTER, input.selectionRect.top),
  );
  return { x, y };
}

function readSelectionActionState(
  rootElement: HTMLElement,
  selection: Selection | null,
  pointerEndX: number | null,
): SelectionActionState | null {
  const scopedSelection = resolveScopedConversationSelection(rootElement, selection);
  if (!scopedSelection || scopedSelection.scope.dataset.messageId === undefined) return null;
  const sourceRole = scopedSelection.scope.dataset.messageRole;
  if (sourceRole !== "user" && sourceRole !== "assistant") return null;
  const payload = chatMarkdownClipboardPayload({
    rangeCount: 1,
    getRangeAt: () => scopedSelection.range,
  });
  const text = payload?.text.trim() ?? "";
  const rect = rangeRect(scopedSelection.range);
  if (!rect || text.length === 0) return null;
  const columnRect =
    scopedSelection.scope
      .closest<HTMLElement>('[data-timeline-root="true"]')
      ?.getBoundingClientRect() ?? scopedSelection.scope.getBoundingClientRect();
  return {
    sourceMessageId: scopedSelection.scope.dataset
      .messageId as ConversationReferenceSelection["sourceMessageId"],
    sourceRole,
    text,
    columnRect,
    conversationRect: rootElement.getBoundingClientRect(),
    cursorX: pointerEndX ?? rect.left + rect.width / 2,
    rect,
  };
}

export function ConversationSelectionAction({
  rootElement,
  onAddReference,
}: ConversationSelectionActionProps) {
  const iconGradientId = useId().replaceAll(":", "");
  const actionRef = useRef<HTMLButtonElement>(null);
  const pointerEndXRef = useRef<number | null>(null);
  const pointerSelectingRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);
  const [selectionState, setSelectionState] = useState<SelectionActionState | null>(null);
  const [position, setPosition] = useState<Point | null>(null);

  const cancelScheduledRefresh = useCallback(() => {
    if (settleTimerRef.current === null) return;
    window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = null;
  }, []);

  const refreshSelection = useCallback(() => {
    if (!rootElement) {
      setSelectionState(null);
      return;
    }
    setSelectionState(
      readSelectionActionState(rootElement, window.getSelection(), pointerEndXRef.current),
    );
  }, [rootElement]);

  const scheduleSelectionRefresh = useCallback(() => {
    cancelScheduledRefresh();
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      refreshSelection();
    }, CONVERSATION_SELECTION_SETTLE_MS);
  }, [cancelScheduledRefresh, refreshSelection]);

  useEffect(() => {
    if (!rootElement) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      pointerEndXRef.current = null;
      pointerSelectingRef.current = true;
      cancelScheduledRefresh();
      setSelectionState(null);
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (!pointerSelectingRef.current) return;
      pointerEndXRef.current = event.clientX;
      pointerSelectingRef.current = false;
      scheduleSelectionRefresh();
    };
    const handlePointerCancel = () => {
      pointerEndXRef.current = null;
      pointerSelectingRef.current = false;
      cancelScheduledRefresh();
      setSelectionState(null);
    };
    const handleKeyUp = () => {
      pointerEndXRef.current = null;
      scheduleSelectionRefresh();
    };
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const action = conversationSelectionChangeAction({
        hasSelection: Boolean(selection && !selection.isCollapsed && selection.rangeCount > 0),
        isPointerSelecting: pointerSelectingRef.current,
      });
      if (action === "hide") {
        pointerEndXRef.current = null;
        cancelScheduledRefresh();
        setSelectionState(null);
      } else if (action === "schedule") {
        scheduleSelectionRefresh();
      }
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refreshSelection);
    resizeObserver?.observe(rootElement);
    rootElement.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    rootElement.addEventListener("keyup", handleKeyUp);
    document.addEventListener("selectionchange", handleSelectionChange);
    window.addEventListener("resize", refreshSelection);
    rootElement.addEventListener("scroll", refreshSelection, true);
    return () => {
      cancelScheduledRefresh();
      pointerEndXRef.current = null;
      pointerSelectingRef.current = false;
      resizeObserver?.disconnect();
      rootElement.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      rootElement.removeEventListener("keyup", handleKeyUp);
      document.removeEventListener("selectionchange", handleSelectionChange);
      window.removeEventListener("resize", refreshSelection);
      rootElement.removeEventListener("scroll", refreshSelection, true);
    };
  }, [cancelScheduledRefresh, refreshSelection, rootElement, scheduleSelectionRefresh]);

  useLayoutEffect(() => {
    const action = actionRef.current;
    if (!action || !selectionState) {
      setPosition(null);
      return;
    }
    const actionRect = action.getBoundingClientRect();
    setPosition(
      clampSelectionActionPosition({
        selectionRect: selectionState.rect,
        columnRect: selectionState.columnRect,
        conversationRect: selectionState.conversationRect,
        cursorX: selectionState.cursorX,
        popupWidth: actionRect.width,
        popupHeight: actionRect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }),
    );
  }, [selectionState]);

  if (!selectionState || typeof document === "undefined" || !document.body) return null;

  return createPortal(
    <button
      ref={actionRef}
      type="button"
      className="layer-tooltip motion-focus motion-press fixed isolate inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-popover px-2 py-1.5 text-xs font-medium text-popover-foreground shadow-md/5 outline-none transition-[background-color,border-color,opacity,transform] duration-150 hover:border-primary/35 hover:bg-popover focus-visible:ring-2 focus-visible:ring-ring/65 motion-reduce:transition-none"
      style={{
        left: position?.x ?? selectionState.rect.left + selectionState.rect.width / 2,
        top: position?.y ?? selectionState.rect.top,
        opacity: position ? 1 : 0,
        transform: position ? "translateX(-50%)" : "translate(-50%, -100%)",
      }}
      onPointerDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        onAddReference(selectionState);
        window.getSelection()?.removeAllRanges();
        setSelectionState(null);
      }}
    >
      <svg className="absolute size-0" aria-hidden>
        <defs>
          <linearGradient id={iconGradientId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="var(--astro-highlight)" />
            <stop offset="1" stopColor="var(--primary)" />
          </linearGradient>
        </defs>
      </svg>
      <MessageSquarePlus
        className="size-3.5 shrink-0"
        style={{ stroke: `url(#${iconGradientId})` }}
        aria-hidden
      />
      Add to prompt
    </button>,
    document.body,
  );
}
