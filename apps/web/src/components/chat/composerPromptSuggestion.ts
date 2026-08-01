import type { SessionPhase } from "../../types";

/**
 * Decision inputs for "should we ask the server for a ghost next-prompt?".
 *
 * Kept as a pure function so the phase-edge rules are testable without
 * mounting ChatComposer — the edge detection is where this feature's
 * regressions live (a settle on one thread must not fire on another).
 */
export interface PromptSuggestionTriggerInput {
  /** Phase recorded on the previous render pass. */
  readonly previousPhase: SessionPhase;
  /** Thread the previous phase was recorded for. */
  readonly previousPhaseThreadId: string | null;
  readonly phase: SessionPhase;
  readonly threadId: string | null;
  readonly environmentId: string | null;
  /** Current composer draft text (raw, untrimmed). */
  readonly draft: string;
  /** True while an approval prompt owns the composer. */
  readonly approvalActive: boolean;
}

/**
 * True only on a running → settled edge that happened on the thread the user
 * is still looking at, with an empty composer and no approval UI.
 */
export function shouldRequestPromptSuggestion(input: PromptSuggestionTriggerInput): boolean {
  if (input.phase === "running") return false;
  // Both halves of the edge must belong to the same thread, otherwise
  // navigating away from a running thread onto an idle one reads as a settle.
  if (input.previousPhaseThreadId !== input.threadId) return false;
  if (input.previousPhase !== "running") return false;
  if (!input.threadId || !input.environmentId) return false;
  if (input.draft.trim().length > 0) return false;
  if (input.approvalActive) return false;
  return true;
}

export interface GhostVisibilityInput {
  /** The suggestion currently held for this thread, if any. */
  readonly ghostSuggestion: string | null;
  /** Current composer draft text (raw, untrimmed). */
  readonly draft: string;
  readonly approvalActive: boolean;
  /** True while a pending-question panel owns the composer. */
  readonly pendingProgressActive: boolean;
}

/**
 * The ghost to paint, or null to paint the normal placeholder.
 *
 * Typing HIDES the suggestion rather than discarding it, so clearing the
 * draft back to empty brings the same suggestion back instead of costing
 * another generation. The suggestion is only discarded on a new turn or a
 * thread/draft switch.
 */
export function resolveVisibleGhostSuggestion(input: GhostVisibilityInput): string | null {
  if (!input.ghostSuggestion) return null;
  if (input.approvalActive) return null;
  if (input.pendingProgressActive) return null;
  if (input.draft.trim().length > 0) return null;
  return input.ghostSuggestion;
}

export interface GhostAcceptInput {
  readonly key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab";
  readonly shiftKey: boolean;
  /** True while the slash/path command menu owns Tab. */
  readonly menuIsActive: boolean;
  readonly ghostSuggestion: string | null;
  readonly draft: string;
}

/**
 * True when Tab should materialize the ghost into the real draft.
 *
 * Deliberately loses to Shift+Tab (interaction-mode toggle) and to an open
 * command/path menu, and never fires on Enter — Enter only ever sends real
 * draft text.
 */
export function shouldAcceptGhostSuggestion(input: GhostAcceptInput): boolean {
  if (input.key !== "Tab") return false;
  if (input.shiftKey) return false;
  if (input.menuIsActive) return false;
  if (!input.ghostSuggestion) return false;
  if (input.draft.trim().length > 0) return false;
  return true;
}
