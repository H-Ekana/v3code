import * as Schema from "effect/Schema";

import { NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

export const AGENT_TRANSCRIPT_DEFAULT_LIMIT = 50;
export const AGENT_TRANSCRIPT_MAX_LIMIT = 100;

export const AgentTranscriptMessageItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: Schema.Literal("message"),
  role: Schema.Literals(["user", "assistant", "system"]),
  text: TrimmedNonEmptyString,
  phase: Schema.optional(Schema.Literals(["commentary", "final"])),
});

export const AgentTranscriptWorkItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: Schema.Literal("work"),
  category: Schema.Literals(["command", "files", "tool", "search", "delegation", "other"]),
  label: TrimmedNonEmptyString,
  status: Schema.Literals(["running", "completed", "failed"]),
  detail: Schema.optional(TrimmedNonEmptyString),
  outcome: Schema.optional(TrimmedNonEmptyString),
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
