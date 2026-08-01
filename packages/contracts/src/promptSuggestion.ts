import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const SuggestNextPromptInput = Schema.Struct({
  threadId: ThreadId,
});
export type SuggestNextPromptInput = typeof SuggestNextPromptInput.Type;

export const SuggestNextPromptResult = Schema.Struct({
  /** Null when no useful next prompt is obvious. */
  suggestion: Schema.NullOr(TrimmedNonEmptyString),
  /**
   * Opaque id for this generation, for logging/telemetry correlation only.
   * It is NOT ordered, so clients must not use it to reason about staleness —
   * superseded requests are dropped by the client command's `latest`
   * concurrency mode instead.
   */
  generationId: TrimmedNonEmptyString,
});
export type SuggestNextPromptResult = typeof SuggestNextPromptResult.Type;

export class SuggestNextPromptError extends Schema.TaggedErrorClass<SuggestNextPromptError>()(
  "SuggestNextPromptError",
  {
    message: TrimmedNonEmptyString,
  },
) {}
