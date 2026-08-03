export type TimelineScrollMode = "following-end" | "free-scrolling";

export interface TimelineSendScrollDecision {
  /**
   * Scroll mode to enter the moment the user sends. Sending never jumps the
   * just-sent turn to the top of the viewport. See {@link resolveTimelineSendScroll}.
   */
  readonly mode: TimelineScrollMode;
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
 * - If the reader was at the live edge (the normal case — they were composing
 *   at the bottom), follow the end and run the deterministic reveal
 *   ({@link resolveSentMessageRevealOffset}) so the sent bubble lands just
 *   above the composer.
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

export interface TimelineEndSignalDecision {
  /** The value `isAtEndRef` should carry after this signal. */
  readonly nextIsAtEnd: boolean;
  /** Re-arm live-follow: mode `following-end`, follow output on. */
  readonly enterFollowingEnd: boolean;
  /** Stand down to `free-scrolling` and stop following output. */
  readonly enterFreeScrolling: boolean;
  /** Clear the pending + visible "a new text" signal. */
  readonly hideNewTextIndicator: boolean;
}

/**
 * Decides what reaching (or leaving) the live edge means for follow state and
 * the "a new text" indicator.
 *
 * `isAtEnd` is LegendList's generous half-viewport `isNearEnd` (drives
 * "caught up" / indicator dismissal). `isStrictlyAtEnd` is the true live edge.
 *
 * Re-arming follow from free-scrolling requires the **strict** edge. A wheel
 * gesture cancels live-follow on every tick without clearing the at-end flag;
 * if the reader is still pinned to the true bottom, the next end signal must
 * re-arm so streamed chunks do not strand the "New messages" chip. But if they
 * only left the strict edge (still inside the half-viewport slack), treating
 * that as re-arm caused tool rows / other non-text growth to snap them back
 * to the bottom while free-scrolling.
 *
 * Leaving the edge while live-follow is armed is deliberately NOT treated as
 * the reader opting out — that is programmatic drift (content growing under a
 * pinned viewport), so follow state is left alone and only the indicator is
 * cleared.
 */
export function resolveTimelineEndSignal(input: {
  readonly isAtEnd: boolean;
  readonly isStrictlyAtEnd: boolean;
  readonly previousIsAtEnd: boolean;
  readonly liveFollowArmed: boolean;
}): TimelineEndSignalDecision {
  if (!input.isAtEnd && input.liveFollowArmed) {
    return {
      nextIsAtEnd: input.previousIsAtEnd,
      enterFollowingEnd: false,
      enterFreeScrolling: false,
      hideNewTextIndicator: true,
    };
  }

  if (input.isAtEnd) {
    // Stay following when already armed; only re-enter follow from free when
    // the reader is on the true live edge (not merely within half a viewport).
    const enterFollowingEnd = input.liveFollowArmed || input.isStrictlyAtEnd;
    return {
      nextIsAtEnd: true,
      enterFollowingEnd,
      enterFreeScrolling: false,
      hideNewTextIndicator: enterFollowingEnd,
    };
  }

  return {
    nextIsAtEnd: false,
    enterFollowingEnd: false,
    enterFreeScrolling: input.previousIsAtEnd,
    hideNewTextIndicator: false,
  };
}

/**
 * A row's viewport-relative top, captured immediately before a fold commit.
 *
 * Folds are measured in VIEWPORT space, not content space, on purpose: it makes
 * the correction idempotent with legend-list's own `maintainVisibleContentPosition`
 * pass. When MVCP compensated the fold, the anchor did not visually move, the
 * measured delta is ~0, and {@link resolveFoldScrollCorrectionFromCandidates}
 * returns `null` instead of double-correcting.
 */
export interface TimelineAnchorSample {
  readonly rowId: string;
  readonly viewportTop: number;
}

/**
 * The scroll offset that undoes a fold's visual jump, or `null` when there is
 * nothing to undo.
 *
 * Candidates are supplied in viewport order (topmost first) because a fold
 * deletes rows: the first candidate that still exists after the commit is the
 * closest surviving anchor to where the reader was actually looking.
 */
export function resolveFoldScrollCorrectionFromCandidates(input: {
  readonly currentScroll: number;
  readonly candidates: readonly TimelineAnchorSample[];
  readonly measureViewportTop: (rowId: string) => number | null;
}): number | null {
  if (!Number.isFinite(input.currentScroll)) {
    return null;
  }

  for (const candidate of input.candidates) {
    const viewportTopAfter = input.measureViewportTop(candidate.rowId);
    if (viewportTopAfter === null || !Number.isFinite(viewportTopAfter)) {
      continue;
    }

    const delta = viewportTopAfter - candidate.viewportTop;
    if (Math.abs(delta) <= 0.5) {
      return null;
    }

    const offset = Math.max(0, input.currentScroll + delta);
    return Math.abs(offset - input.currentScroll) <= 0.5 ? null : offset;
  }

  // Every anchor the reader could see was deleted by the fold. There is no
  // honest correction to make, so leave the scroller alone rather than guess.
  return null;
}

export interface TimelineListMeasurementState {
  readonly data: readonly unknown[];
  readonly scroll: number;
  readonly scrollLength: number;
  readonly positionAtIndex: (index: number) => number | undefined;
  readonly sizeAtIndex: (index: number) => number | undefined;
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

/**
 * The exact scroll offset that reveals a just-sent user message directly above
 * the composer — never more, never less, and never backward.
 *
 * This replaces the `maintainScrollAtEnd` + `scrollToEnd` race. `scrollToEnd`
 * targets `contentSize`, which includes `contentInsetEndAdjustment` (the real
 * DOM spacer legend-list renders for the composer), so it is only ever right by
 * accident. Here the target is computed from the *real* content bottom and the
 * usable viewport (viewport minus composer), so:
 *
 * - G1: the message's bottom lands `anchorOffset` above the composer's top edge;
 * - G2: if the message is taller than the usable viewport, its TOP is aligned
 *   near the viewport top instead (revealing its end would hide its start);
 * - G4: the result is clamped to `>= currentScroll` in the normal branch, so a
 *   send can never scroll the viewport backward toward the start of the thread.
 *
 * Returns `null` when there is nothing to do (already in place, degenerate
 * viewport, sub-pixel delta) — callers must not scroll on `null`.
 */
export function resolveSentMessageRevealOffset(input: {
  readonly currentScroll: number;
  readonly scrollLength: number;
  readonly composerInset: number;
  readonly messageTop: number;
  readonly contentBottom: number;
  readonly anchorOffset: number;
}): number | null {
  const usableViewport = Math.max(0, input.scrollLength - input.composerInset);
  if (usableViewport <= 0) {
    return null;
  }

  const messageHeight = input.contentBottom - input.messageTop;
  const target =
    messageHeight > usableViewport - input.anchorOffset
      ? input.messageTop - input.anchorOffset
      : Math.max(input.currentScroll, input.contentBottom - usableViewport + input.anchorOffset);

  const clamped = Math.max(0, target);
  if (Math.abs(clamped - input.currentScroll) <= 1) {
    return null;
  }
  return clamped;
}
