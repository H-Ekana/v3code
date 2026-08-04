import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind } from "./providerInstance.ts";
import { ToolLifecycleItemType } from "./providerRuntime.ts";

export const AGENT_TRANSCRIPT_DEFAULT_LIMIT = 50;
export const AGENT_TRANSCRIPT_MAX_LIMIT = 100;

/**
 * `thinking` carries provider-exposed reasoning. Claude forwards verbatim
 * thinking blocks; Codex only ever exposes summaries (its raw reasoning is
 * `encrypted_content`), so the same category means "as much reasoning as the
 * provider is willing to show", not "the full chain of thought".
 */
export const AGENT_TRANSCRIPT_WORK_CATEGORIES = [
  "command",
  "files",
  "tool",
  "search",
  "delegation",
  "thinking",
  "other",
] as const;
export type AgentTranscriptWorkCategory = (typeof AGENT_TRANSCRIPT_WORK_CATEGORIES)[number];

export const AgentTranscriptMessageItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: Schema.Literal("message"),
  role: Schema.Literals(["user", "assistant", "system"]),
  text: TrimmedNonEmptyString,
  /**
   * Provider timestamp, for display. Optional because not every provider
   * stamps every record, and never load-bearing for ordering — see
   * {@link AgentTranscriptItem} `ordinal`.
   */
  at: Schema.optional(IsoDateTime),
  /**
   * Absolute position in the whole transcript, stable across pages.
   *
   * Ordering cannot ride on `at`: several blocks of one record share a
   * timestamp, and a page is normalized without sight of its neighbours, so
   * any per-page tie-breaking of timestamps makes page 2 sort into page 1's
   * tail. This is derived from the provider's own record order, which is
   * chronological, so sorting by it is correct however the pages arrive.
   */
  ordinal: Schema.optional(NonNegativeInt),
  phase: Schema.optional(Schema.Literals(["commentary", "final"])),
});

export const AgentTranscriptWorkItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: Schema.Literal("work"),
  category: Schema.Literals(AGENT_TRANSCRIPT_WORK_CATEGORIES),
  label: TrimmedNonEmptyString,
  status: Schema.Literals(["running", "completed", "failed"]),
  /** See {@link AgentTranscriptMessageItem} `at`. */
  at: Schema.optional(IsoDateTime),
  /** See {@link AgentTranscriptMessageItem} `ordinal`. */
  ordinal: Schema.optional(NonNegativeInt),
  detail: Schema.optional(TrimmedNonEmptyString),
  outcome: Schema.optional(TrimmedNonEmptyString),
  /**
   * Stable identity of the underlying tool call, pairing an invocation with its
   * result. Readers collapse the pair into a single item the way the main
   * timeline collapses `tool.started` -> `tool.completed`.
   */
  toolCallId: Schema.optional(TrimmedNonEmptyString),
  /** Provider tool name (`Read`, `Bash`, `apply_patch`), before any prettifying. */
  toolName: Schema.optional(TrimmedNonEmptyString),
  /** Canonical lifecycle type, so shared renderers resolve the same icon as the main chat. */
  itemType: Schema.optional(ToolLifecycleItemType),
  /** Verbatim command text for command executions. */
  command: Schema.optional(TrimmedNonEmptyString),
  changedFiles: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});

export const AgentTranscriptItem = Schema.Union([
  AgentTranscriptMessageItem,
  AgentTranscriptWorkItem,
]);
export type AgentTranscriptItem = typeof AgentTranscriptItem.Type;

export const AgentTranscriptRequest = Schema.Struct({
  threadId: ThreadId,
  sourceProvider: ProviderDriverKind,
  agentId: TrimmedNonEmptyString,
  cursor: Schema.optional(NonNegativeInt),
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: AGENT_TRANSCRIPT_MAX_LIMIT })),
  ),
});
export type AgentTranscriptRequest = typeof AgentTranscriptRequest.Type;

export const AgentTranscriptAvailable = Schema.Struct({
  status: Schema.Literal("available"),
  items: Schema.Array(AgentTranscriptItem),
  nextCursor: Schema.optional(NonNegativeInt),
  complete: Schema.Boolean,
  revision: Schema.optional(NonNegativeInt),
});

export const AgentTranscriptUnavailableReason = Schema.Literals([
  "thread-not-found",
  "agent-not-found",
  "provider-mismatch",
  "agent-kind-unsupported",
  "provider-unsupported",
  "session-unavailable",
  "transcript-not-found",
]);
export type AgentTranscriptUnavailableReason = typeof AgentTranscriptUnavailableReason.Type;

export const AgentTranscriptUnavailable = Schema.Struct({
  status: Schema.Literals(["unsupported", "not-found"]),
  reason: AgentTranscriptUnavailableReason,
  message: TrimmedNonEmptyString,
});

export const AgentTranscriptResult = Schema.Union([
  AgentTranscriptAvailable,
  AgentTranscriptUnavailable,
]);
export type AgentTranscriptResult = typeof AgentTranscriptResult.Type;

export class AgentTranscriptReadError extends Schema.TaggedErrorClass<AgentTranscriptReadError>()(
  "AgentTranscriptReadError",
  { message: TrimmedNonEmptyString },
) {}
