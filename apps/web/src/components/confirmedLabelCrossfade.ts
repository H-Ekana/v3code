import { useRef } from "react";

/**
 * Plan item 18: "Crossfade branch/environment labels only after confirmed
 * changes."
 *
 * Two things this has to get right:
 *
 *  1. Optimistic text (the branch selector swaps its label the instant you pick
 *     a ref, before the checkout lands) must NOT crossfade. Feed this the
 *     canonical/server value, never the optimistic one.
 *  2. The very first render is not a change. A toolbar remount — switching
 *     threads, restoring a session — must not replay the crossfade, so the
 *     generation stays at 0 until a real transition is observed.
 */
export function advanceConfirmedChangeGeneration(input: {
  readonly previousValue: string | null;
  readonly nextValue: string | null;
  readonly generation: number;
}): number {
  return input.previousValue === input.nextValue ? input.generation : input.generation + 1;
}

/**
 * Returns a remount key for the label element, or `null` while no confirmed
 * change has been observed yet. Callers apply `feedback-label-crossfade` only
 * when a key is present.
 */
export function useConfirmedLabelCrossfade(confirmedValue: string | null): string | null {
  const previousValueRef = useRef<string | null>(confirmedValue);
  const generationRef = useRef(0);

  // Derived-during-render, and idempotent: a repeated render with the same
  // value takes the equality branch and cannot double-increment.
  generationRef.current = advanceConfirmedChangeGeneration({
    previousValue: previousValueRef.current,
    nextValue: confirmedValue,
    generation: generationRef.current,
  });
  previousValueRef.current = confirmedValue;

  return generationRef.current === 0 ? null : `confirmed-${generationRef.current}`;
}
