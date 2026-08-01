import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const SuggestNextPromptInput = Schema.Struct({
  threadId: ThreadId,
});
export type SuggestNextPromptInput = typeof SuggestNextPromptInput.Type;

export const SuggestNextPromptResult = Schema.Struct({
  /** Null when no useful next prompt is obvious. */
  suggestion: Schema.NullOr(TrimmedNonEmptyString),
  /** Monotonic id for this generation so clients can drop stale results. */
  generationId: TrimmedNonEmptyString,
});
export type SuggestNextPromptResult = typeof SuggestNextPromptResult.Type;

export class SuggestNextPromptError extends Schema.TaggedErrorClass<SuggestNextPromptError>()(
  "SuggestNextPromptError",
  {
    message: TrimmedNonEmptyString,
  },
) {}
