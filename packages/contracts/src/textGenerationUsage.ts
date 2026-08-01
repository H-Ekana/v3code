import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/**
 * Which side job spent the tokens. Every text-generation operation is
 * recorded, not just composer ghost prompts — they all bill the text
 * generation model (or, for source control, its dedicated writer override).
 */
export const TextGenerationUsageOperation = Schema.Literals([
  "generateCommitMessage",
  "generatePrContent",
  "generateBranchName",
  "generateThreadTitle",
  "generatePromptSuggestion",
]);
export type TextGenerationUsageOperation = typeof TextGenerationUsageOperation.Type;

/**
 * One row of the tally, keyed by the model that actually ran and the job it
 * ran for. Counts come from our own call sites, so they cover exactly these
 * operations — never the user's coding traffic, even on a shared model.
 *
 * Token fields are null when the provider does not report usage back to us.
 * Null means "not reported"; it is NOT zero, and must not be rendered as $0.
 */
export const TextGenerationUsageEntry = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  operation: TextGenerationUsageOperation,
  calls: NonNegativeInt,
  /** Calls that produced usable output (a suggestion shown, a message written). */
  succeededCalls: NonNegativeInt,
  /** Uncached input tokens, billed at the full input rate. */
  inputTokens: Schema.NullOr(NonNegativeInt),
  /** Cached input tokens, billed at the (much cheaper) cache-read rate. */
  cachedInputTokens: Schema.NullOr(NonNegativeInt),
  outputTokens: Schema.NullOr(NonNegativeInt),
  /**
   * Estimated spend in USD from a local price table, or null when we have no
   * price for the model. Always an estimate — never a provider-billed figure.
   */
  estimatedCostUsd: Schema.NullOr(Schema.Number),
  lastUsedAt: Schema.NullOr(TrimmedNonEmptyString),
});
export type TextGenerationUsageEntry = typeof TextGenerationUsageEntry.Type;

/**
 * Reporting window. Usage is stored as per-day rows (like CodexBar's daily
 * ledger) and aggregated on read, so switching windows never loses history —
 * which is why there is no destructive "reset" in the normal flow.
 */
export const TextGenerationUsageWindow = Schema.Literals([
  "today",
  "yesterday",
  "last7Days",
  "last30Days",
  "lastYear",
  "allTime",
]);
export type TextGenerationUsageWindow = typeof TextGenerationUsageWindow.Type;

export const TextGenerationUsageInput = Schema.Struct({
  window: TextGenerationUsageWindow,
});
export type TextGenerationUsageInput = typeof TextGenerationUsageInput.Type;

export const TextGenerationUsageResult = Schema.Struct({
  window: TextGenerationUsageWindow,
  entries: Schema.Array(TextGenerationUsageEntry),
  /** Sum over entries with a known price; null when none have one. */
  totalEstimatedCostUsd: Schema.NullOr(Schema.Number),
  /** True when some usage could not be priced — the UI must say so. */
  hasUnpricedUsage: Schema.Boolean,
  /** True when some provider reported no tokens at all for recorded calls. */
  hasUnreportedTokens: Schema.Boolean,
  /** Earliest day (YYYY-MM-DD) with recorded usage, across all windows. */
  since: Schema.NullOr(TrimmedNonEmptyString),
});
export type TextGenerationUsageResult = typeof TextGenerationUsageResult.Type;

export const ResetTextGenerationUsageResult = Schema.Struct({
  cleared: Schema.Boolean,
});
export type ResetTextGenerationUsageResult = typeof ResetTextGenerationUsageResult.Type;

export class TextGenerationUsageError extends Schema.TaggedErrorClass<TextGenerationUsageError>()(
  "TextGenerationUsageError",
  {
    message: TrimmedNonEmptyString,
  },
) {}
