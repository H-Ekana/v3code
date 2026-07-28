/**
 * Interaction helpers for the files and diffs surfaces (motion plan item 17).
 *
 * These surfaces render very large trees and virtualized diffs, so everything
 * here is deliberately cheap: a mount-time delay for pending indicators, a
 * direction for one short 4px scope navigation, and a size guard that keeps
 * a reveal off big trees. No per-row state and no per-row animation.
 */

import { useEffect, useState } from "react";

/**
 * How long a pending state must last before its skeleton/spinner is allowed to
 * appear. Cached file reads and cached diffs resolve well inside this window,
 * so they swap straight to content instead of flashing a skeleton.
 *
 * Deliberately its own token, decoupled from {@link FILES_CROSSFADE_MS}: the two
 * were accidentally identical at 140ms, so on a slow load the state crossfade
 * finished exactly as the skeleton first appeared and every loading enter played
 * out over an empty container. They must be tuned independently.
 */
export const FILES_SKELETON_DELAY_MS = 140;

/**
 * Duration of the files/diffs state crossfade (loading/error/empty/content and
 * diff-scope handoffs). The outgoing surface is retained and fades out over this
 * window while the incoming one animates in. Plan item 17 crossfade band is
 * 140-180ms; landed at the loud end (180ms) for review. Mirrors
 * `--files-crossfade` in styles/files-diffs.css, which drives the CSS animation;
 * this JS copy is the timer that drops the retained outgoing layer.
 */
export const FILES_CROSSFADE_MS = 180;

/**
 * Above this many entries a changed-files container is left unanimated. One
 * container-level opacity/translate is cheap for a small tree and needlessly
 * expensive once the tree is large, and staggering rows is a non-goal.
 */
export const CHANGED_FILES_REVEAL_MAX_ENTRIES = 60;

export type DiffScopeDirection = "forward" | "backward" | "none";

function noop(): void {}

/**
 * Effect body behind {@link useDeferredPending}, extracted so the timing
 * contract can be tested without a DOM.
 *
 * Returns the cleanup that cancels a not-yet-elapsed delay. A pending window
 * shorter than `delayMs` therefore never reports `true`.
 */
export function startDeferredPending(
  pending: boolean,
  delayMs: number,
  onElapsedChange: (elapsed: boolean) => void,
): () => void {
  if (!pending) {
    onElapsedChange(false);
    return noop;
  }
  if (delayMs <= 0) {
    onElapsedChange(true);
    return noop;
  }
  const timer = setTimeout(() => onElapsedChange(true), delayMs);
  return () => clearTimeout(timer);
}

/**
 * `true` only once `pending` has been continuously true for `delayMs`.
 * Drops back to `false` in the same commit that clears `pending`.
 */
export function useDeferredPending(
  pending: boolean,
  delayMs: number = FILES_SKELETON_DELAY_MS,
): boolean {
  const [elapsed, setElapsed] = useState(delayMs <= 0);
  useEffect(() => startDeferredPending(pending, delayMs, setElapsed), [delayMs, pending]);
  return pending && elapsed;
}

/**
 * Direction for the short diff-scope navigation. `none` means "do not travel":
 * the first scope shown in a session, and any re-selection of the current
 * scope, get a plain crossfade rather than a directional move.
 */
export function diffScopeNavigationDirection(
  previousScopeKey: string | null,
  nextScopeKey: string,
  orderedScopeKeys: readonly string[],
): DiffScopeDirection {
  if (previousScopeKey === null || previousScopeKey === nextScopeKey) {
    return "none";
  }
  const previousIndex = orderedScopeKeys.indexOf(previousScopeKey);
  const nextIndex = orderedScopeKeys.indexOf(nextScopeKey);
  if (previousIndex < 0 || nextIndex < 0) {
    return "forward";
  }
  return nextIndex > previousIndex ? "forward" : "backward";
}

/** Whether a changed-files container is small enough to reveal as one unit. */
export function shouldRevealChangedFiles(entryCount: number): boolean {
  return entryCount > 0 && entryCount <= CHANGED_FILES_REVEAL_MAX_ENTRIES;
}
