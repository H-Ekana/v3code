import { getSubagentMessages, type SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  AGENT_TRANSCRIPT_DEFAULT_LIMIT,
  AgentTranscriptReadError,
  type AgentTranscriptItem,
  type AgentTranscriptRequest,
  type AgentTranscriptResult,
  type AgentTranscriptUnavailableReason,
  NonNegativeInt,
  THREAD_AGENTS_ACTIVITY_KIND,
  ThreadAgentSnapshot,
  type OrchestrationThread,
  type ProviderSession,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProviderThreadSnapshot } from "./Services/ProviderAdapter.ts";

const RosterPayload = Schema.Struct({
  agents: Schema.Array(Schema.Unknown),
  revision: Schema.optional(NonNegativeInt),
});
const ResumeCursor = Schema.Struct({ resume: Schema.optional(Schema.String) });
const TranscriptMessageBody = Schema.Struct({
  content: Schema.Union([Schema.String, Schema.Array(Schema.Unknown)]),
});
const TextContentBlock = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
});

const decodeRosterPayload = Schema.decodeUnknownOption(RosterPayload);
const decodeAgent = Schema.decodeUnknownOption(ThreadAgentSnapshot);
const decodeResumeCursor = Schema.decodeUnknownOption(ResumeCursor);
const decodeMessageBody = Schema.decodeUnknownOption(TranscriptMessageBody);
const decodeTextContentBlock = Schema.decodeUnknownOption(TextContentBlock);

type TranscriptMessage = Pick<
  SessionMessage,
  "type" | "uuid" | "session_id" | "message" | "parent_tool_use_id"
>;

export interface AgentTranscriptReaderDependencies {
  readonly getThread: (
    threadId: AgentTranscriptRequest["threadId"],
  ) => Effect.Effect<Option.Option<OrchestrationThread>, AgentTranscriptReadError>;
  readonly listSessions: () => Effect.Effect<
    ReadonlyArray<ProviderSession>,
    AgentTranscriptReadError
  >;
  readonly getClaudeSubagentMessages?: (
    sessionId: string,
    agentId: string,
    options: { readonly dir?: string; readonly limit: number; readonly offset: number },
  ) => Promise<ReadonlyArray<TranscriptMessage>>;
  readonly readCodexAgentThread?: (
    threadId: AgentTranscriptRequest["threadId"],
    agentId: string,
  ) => Effect.Effect<ProviderThreadSnapshot, AgentTranscriptReadError>;
}

interface RosterAgent {
  readonly agent: ThreadAgentSnapshot;
  readonly revision: number | undefined;
}

function findRosterAgent(thread: OrchestrationThread, agentId: string): RosterAgent | undefined {
  let latest:
    | { readonly agents: ReadonlyArray<unknown>; readonly revision: number | undefined }
    | undefined;
  let latestRank = -1;

  for (const activity of thread.activities) {
    if (activity.kind !== THREAD_AGENTS_ACTIVITY_KIND) continue;
    const decoded = decodeRosterPayload(activity.payload);
    if (Option.isNone(decoded)) continue;
    const rank = decoded.value.revision ?? -1;
    if (latest === undefined || rank >= latestRank) {
      latest = { agents: decoded.value.agents, revision: decoded.value.revision };
      latestRank = rank;
    }
  }

  if (!latest) return undefined;
  for (const candidate of latest.agents) {
    const decoded = decodeAgent(candidate);
    if (Option.isSome(decoded) && String(decoded.value.agentId) === agentId) {
      return { agent: decoded.value, revision: latest.revision };
    }
  }
  return undefined;
}

function visibleText(message: TranscriptMessage): string | undefined {
  const body = decodeMessageBody(message.message);
  if (Option.isNone(body)) return undefined;
  if (typeof body.value.content === "string") {
    const text = body.value.content.trim();
    return text.length > 0 ? text : undefined;
  }

  const text = body.value.content.flatMap((candidate) => {
    const block = decodeTextContentBlock(candidate);
    if (Option.isNone(block)) return [];
    const value = block.value.text.trim();
    return value.length > 0 ? [value] : [];
  });
  return text.length > 0 ? text.join("\n\n") : undefined;
}

export function normalizeClaudeTranscriptMessages(
  messages: ReadonlyArray<TranscriptMessage>,
): ReadonlyArray<AgentTranscriptItem> {
  return messages.flatMap((message) => {
    const text = visibleText(message);
    return text
      ? [
          {
            id: message.uuid,
            kind: "message",
            role: message.type,
            text,
          } satisfies AgentTranscriptItem,
        ]
      : [];
  });
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function bounded(value: unknown, limit = 4_000): string | undefined {
  const visible = text(value);
  if (!visible) return undefined;
  return visible.length <= limit ? visible : `${visible.slice(0, limit)}\n…`;
}

function workStatus(value: unknown): "running" | "completed" | "failed" {
  if (value === "inProgress") return "running";
  if (value === "failed" || value === "declined") return "failed";
  return "completed";
}

function userInputText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap((candidate) => {
    const item = record(candidate);
    return item?.type === "text" && text(item.text) ? [text(item.text)!] : [];
  });
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function jsonDetail(value: unknown): string | undefined {
  try {
    return bounded(JSON.stringify(value, null, 2));
  } catch {
    return undefined;
  }
}

export function normalizeCodexTranscriptItems(
  turns: ProviderThreadSnapshot["turns"],
): ReadonlyArray<AgentTranscriptItem> {
  return turns.flatMap((turn) =>
    turn.items.flatMap((candidate): ReadonlyArray<AgentTranscriptItem> => {
      const item = record(candidate);
      const id = text(item?.id);
      const type = item?.type;
      if (!item || !id || typeof type !== "string") return [];

      if (type === "userMessage") {
        const value = userInputText(item.content);
        return value ? [{ id, kind: "message", role: "user", text: value } as const] : [];
      }
      if (type === "agentMessage") {
        const value = text(item.text);
        return value
          ? [
              {
                id,
                kind: "message",
                role: "assistant",
                text: value,
                ...(item.phase === "final_answer"
                  ? { phase: "final" as const }
                  : item.phase === "commentary"
                    ? { phase: "commentary" as const }
                    : {}),
              } as const,
            ]
          : [];
      }
      // Reasoning content is intentionally not exposed as transcript content.
      if (type === "reasoning" || type === "hookPrompt" || type === "subAgentActivity") return [];
      if (type === "commandExecution") {
        const actions = Array.isArray(item.commandActions) ? item.commandActions.map(record) : [];
        const firstAction = actions.find(Boolean);
        const actionLabel =
          firstAction?.type === "read"
            ? "Read a file"
            : firstAction?.type === "listFiles"
              ? "Listed files"
              : firstAction?.type === "search"
                ? "Searched the codebase"
                : "Ran a command";
        return [
          {
            id,
            kind: "work",
            category: "command",
            label: actionLabel,
            status: workStatus(item.status),
            ...(bounded(item.command) ? { detail: bounded(item.command) } : {}),
            ...(bounded(item.aggregatedOutput) ? { outcome: bounded(item.aggregatedOutput) } : {}),
          } as const,
        ];
      }
      if (type === "fileChange") {
        const changes = Array.isArray(item.changes) ? item.changes.map(record).filter(Boolean) : [];
        const paths = changes.flatMap((change) =>
          text(change?.path) ? [text(change?.path)!] : [],
        );
        return [
          {
            id,
            kind: "work",
            category: "files",
            label: `Changed ${paths.length || changes.length} ${paths.length === 1 ? "file" : "files"}`,
            status: workStatus(item.status),
            ...(paths.length > 0 ? { detail: paths.join("\n") } : {}),
          } as const,
        ];
      }
      if (type === "mcpToolCall" || type === "dynamicToolCall") {
        const tool = text(item.tool) ?? "tool";
        const server = type === "mcpToolCall" ? text(item.server) : text(item.namespace);
        const error = record(item.error);
        return [
          {
            id,
            kind: "work",
            category: "tool",
            label: `Used ${server ? `${server} · ` : ""}${tool}`,
            status: workStatus(item.status),
            ...(jsonDetail(item.arguments) ? { detail: jsonDetail(item.arguments) } : {}),
            ...(bounded(error?.message) ? { outcome: bounded(error?.message) } : {}),
          } as const,
        ];
      }
      if (type === "webSearch") {
        const query = text(item.query);
        return query
          ? [
              {
                id,
                kind: "work",
                category: "search",
                label: `Searched for “${query}”`,
                status: "completed",
              } as const,
            ]
          : [];
      }
      if (type === "collabAgentToolCall") {
        const labels: Record<string, string> = {
          spawnAgent: "Spawned an agent",
          sendInput: "Sent guidance to an agent",
          resumeAgent: "Resumed an agent",
          wait: "Waited for agents",
          closeAgent: "Closed an agent",
        };
        return [
          {
            id,
            kind: "work",
            category: "delegation",
            label: labels[String(item.tool)] ?? "Coordinated agents",
            status: workStatus(item.status),
            ...(bounded(item.prompt) ? { detail: bounded(item.prompt) } : {}),
          } as const,
        ];
      }
      if (type === "plan") {
        const value = text(item.text);
        return value
          ? [
              {
                id,
                kind: "work",
                category: "other",
                label: "Updated the plan",
                status: "completed",
                detail: value,
              } as const,
            ]
          : [];
      }
      return [];
    }),
  );
}

const unavailable = (
  status: "unsupported" | "not-found",
  reason: AgentTranscriptUnavailableReason,
  message: string,
): AgentTranscriptResult => ({ status, reason, message });

export const readAgentTranscript = Effect.fn("readAgentTranscript")(function* (
  input: AgentTranscriptRequest,
  dependencies: AgentTranscriptReaderDependencies,
): Effect.fn.Return<AgentTranscriptResult, AgentTranscriptReadError> {
  const thread = yield* dependencies.getThread(input.threadId);
  if (Option.isNone(thread)) {
    return unavailable("not-found", "thread-not-found", "The thread no longer exists.");
  }

  const rosterAgent = findRosterAgent(thread.value, String(input.agentId));
  if (!rosterAgent) {
    return unavailable("not-found", "agent-not-found", "The agent is not in this thread's roster.");
  }
  if (rosterAgent.agent.provider !== input.sourceProvider) {
    return unavailable(
      "not-found",
      "provider-mismatch",
      "The requested provider does not own this agent transcript.",
    );
  }
  if (rosterAgent.agent.kind !== "subagent") {
    return unavailable(
      "unsupported",
      "agent-kind-unsupported",
      "Transcript retrieval is currently available only for direct sub-agents.",
    );
  }
  if (input.sourceProvider === "codex") {
    if (!dependencies.readCodexAgentThread) {
      return unavailable(
        "unsupported",
        "provider-unsupported",
        "This server cannot retrieve Codex child conversations.",
      );
    }
    const snapshot = yield* dependencies
      .readCodexAgentThread(input.threadId, String(input.agentId))
      .pipe(Effect.option);
    if (Option.isNone(snapshot)) {
      return unavailable(
        "not-found",
        "session-unavailable",
        "The Codex child conversation is not available from the current parent session.",
      );
    }
    const allItems = normalizeCodexTranscriptItems(snapshot.value.turns);
    const offset = input.cursor ?? 0;
    const limit = input.limit ?? AGENT_TRANSCRIPT_DEFAULT_LIMIT;
    const page = allItems.slice(offset, offset + limit);
    const complete = offset + page.length >= allItems.length;
    return {
      status: "available",
      items: page,
      ...(complete ? {} : { nextCursor: offset + page.length }),
      complete,
      ...(rosterAgent.revision === undefined ? {} : { revision: rosterAgent.revision }),
    };
  }
  if (input.sourceProvider !== "claudeAgent") {
    return unavailable(
      "unsupported",
      "provider-unsupported",
      "This provider does not expose addressable child transcripts yet.",
    );
  }

  const sessions = yield* dependencies.listSessions();
  const session = sessions.find(
    (candidate) =>
      candidate.threadId === input.threadId && candidate.provider === input.sourceProvider,
  );
  if (!session) {
    return unavailable(
      "not-found",
      "session-unavailable",
      "The parent Claude session is not available on this server.",
    );
  }

  const resumeCursor = decodeResumeCursor(session.resumeCursor);
  const parentSessionId = Option.isSome(resumeCursor) ? resumeCursor.value.resume : undefined;
  if (!parentSessionId) {
    return unavailable(
      "not-found",
      "session-unavailable",
      "The parent Claude session has no retrievable transcript identity.",
    );
  }

  const offset = input.cursor ?? 0;
  const limit = input.limit ?? AGENT_TRANSCRIPT_DEFAULT_LIMIT;
  const reader = dependencies.getClaudeSubagentMessages ?? getSubagentMessages;
  const raw = yield* Effect.tryPromise({
    try: () =>
      reader(parentSessionId, String(input.agentId), {
        ...(session.cwd ? { dir: session.cwd } : {}),
        limit: limit + 1,
        offset,
      }),
    catch: () =>
      new AgentTranscriptReadError({ message: "Failed to read the Claude sub-agent transcript." }),
  });

  if (raw.length === 0 && offset === 0) {
    return unavailable(
      "not-found",
      "transcript-not-found",
      "Claude did not return a transcript for this agent.",
    );
  }

  const page = raw.slice(0, limit);
  const complete = raw.length <= limit;
  return {
    status: "available",
    items: normalizeClaudeTranscriptMessages(page),
    ...(complete ? {} : { nextCursor: offset + page.length }),
    complete,
    ...(rosterAgent.revision === undefined ? {} : { revision: rosterAgent.revision }),
  };
});
