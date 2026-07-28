export type TimelineScrollMode = "following-end" | "anchoring-new-turn" | "free-scrolling";

export interface TimelineSendScrollDecision {
  /**
   * Scroll mode to enter the moment the user sends. Note the absence of
   * `anchoring-new-turn`: sending never jumps the just-sent turn to the top of
   * the viewport. See {@link resolveTimelineSendScroll}.
   */
  readonly mode: "following-end" | "free-scrolling";
  /** Whether the list should keep pinning to the live edge after the send. */
  readonly followOutput: boolean;
  /** Whether the reader is treated as sitting at the live edge post-send. */
  readonly isAtEnd: boolean;
}

/**
 * Decides how the timeline scrolls when the user sends a message.
 *
 * The old behavior anchored the new turn to the top of the viewport (a
 * ChatGPT-style jump): the message teleported up and the reply streamed into a
 * reserved tail below it. Users read that as the chat "jumping around", and it
 * also broke the mitosis travel because the composer→slot delta became a full
 * viewport height.
 *
 * The replacement is minimal-scroll:
 * - If the reader was at/near the live edge (the normal case — they were
 *   composing at the bottom), keep following the end. The list stays put and
 *   only scrolls by the height of the freshly-appended message, so the bubble
 *   rises just above the composer and the reply streams right there.
 * - If the reader had scrolled up into history, do not yank them; leave the
 *   viewport where it is (free-scrolling) so their place is preserved.
 *
 * In neither branch does the new turn anchor to the top.
 */
export function resolveTimelineSendScroll(input: {
  readonly userWasAtEnd: boolean;
}): TimelineSendScrollDecision {
  if (input.userWasAtEnd) {
    return { mode: "following-end", followOutput: true, isAtEnd: true };
  }
  return { mode: "free-scrolling", followOutput: false, isAtEnd: false };
}

export function shouldPositionTimelineAnchor(input: {
  readonly liveFollowUserScrollGeneration: number | null;
  readonly userScrollGeneration: number;
}): boolean {
  return input.liveFollowUserScrollGeneration === input.userScrollGeneration;
}

export interface TimelineListMeasurementState {
  readonly data: readonly unknown[];
  readonly scroll: number;
  readonly scrollLength: number;
  readonly positionAtIndex: (index: number) => number | undefined;
  readonly sizeAtIndex: (index: number) => number | undefined;
}

export interface AnchoredTurnMetrics {
  readonly anchorTop: number;
  readonly lastBottom: number;
  readonly turnHeight: number;
  readonly usableViewportHeight: number;
  readonly visibleUsableBottom: number;
  readonly overflowsUsableViewport: boolean;
  readonly targetScrollToRevealEnd: number;
  readonly scrollDeltaToRevealEnd: number;
}

export function getRowBottom(state: TimelineListMeasurementState, index: number): number | null {
  const top = state.positionAtIndex(index);
  const height = state.sizeAtIndex(index);
  if (
    typeof top !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(top) ||
    !Number.isFinite(height)
  ) {
    return null;
  }

  return top + Math.max(1, height);
}

export function getAnchoredTurnMetrics({
  state,
  anchorIndex,
  composerOverlayHeight,
  anchorOffset,
}: {
  readonly state: TimelineListMeasurementState;
  readonly anchorIndex: number;
  readonly composerOverlayHeight: number;
  readonly anchorOffset: number;
}): AnchoredTurnMetrics | null {
  if (state.data.length === 0) {
    return null;
  }

  const boundedAnchorIndex = Math.max(0, Math.min(anchorIndex, state.data.length - 1));
  const anchorTop = state.positionAtIndex(boundedAnchorIndex);
  const lastBottom = getRowBottom(state, state.data.length - 1);
  if (typeof anchorTop !== "number" || !Number.isFinite(anchorTop) || lastBottom === null) {
    return null;
  }

  const usableViewportHeight = Math.max(
    0,
    state.scrollLength - composerOverlayHeight - anchorOffset,
  );
  const turnHeight = Math.max(0, lastBottom - anchorTop);
  const visibleUsableBottom = state.scroll + usableViewportHeight;
  const targetScrollToRevealEnd = Math.max(0, lastBottom - usableViewportHeight);
  const scrollDeltaToRevealEnd = Math.max(0, targetScrollToRevealEnd - state.scroll);

  return {
    anchorTop,
    lastBottom,
    turnHeight,
    usableViewportHeight,
    visibleUsableBottom,
    overflowsUsableViewport: turnHeight > usableViewportHeight,
    targetScrollToRevealEnd,
    scrollDeltaToRevealEnd,
  };
}
