import { getSubagentMessages, type SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  AGENT_TRANSCRIPT_DEFAULT_LIMIT,
  AgentTranscriptReadError,
  type AgentTranscriptItem,
  type AgentTranscriptRequest,
  type AgentTranscriptResult,
  type AgentTranscriptUnavailableReason,
  type AgentTranscriptWorkCategory,
  NonNegativeInt,
  THREAD_AGENTS_ACTIVITY_KIND,
  ThreadAgentSnapshot,
  type ToolLifecycleItemType,
  type OrchestrationThread,
  type ProviderSession,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProviderThreadSnapshot } from "./Services/ProviderAdapter.ts";
import { classifyToolItemType } from "./toolItemType.ts";

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
const ThinkingContentBlock = Schema.Struct({
  type: Schema.Literal("thinking"),
  thinking: Schema.String,
});
const ToolUseContentBlock = Schema.Struct({
  type: Schema.Literal("tool_use"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.optional(Schema.Unknown),
});
const ToolResultContentBlock = Schema.Struct({
  type: Schema.Literal("tool_result"),
  tool_use_id: Schema.String,
  content: Schema.optional(Schema.Unknown),
  is_error: Schema.optional(Schema.Boolean),
});

const decodeRosterPayload = Schema.decodeUnknownOption(RosterPayload);
const decodeAgent = Schema.decodeUnknownOption(ThreadAgentSnapshot);
const decodeResumeCursor = Schema.decodeUnknownOption(ResumeCursor);
const decodeMessageBody = Schema.decodeUnknownOption(TranscriptMessageBody);
const decodeTextContentBlock = Schema.decodeUnknownOption(TextContentBlock);
const decodeThinkingContentBlock = Schema.decodeUnknownOption(ThinkingContentBlock);
const decodeToolUseContentBlock = Schema.decodeUnknownOption(ToolUseContentBlock);
const decodeToolResultContentBlock = Schema.decodeUnknownOption(ToolResultContentBlock);

type TranscriptMessage = Pick<
  SessionMessage,
  "type" | "uuid" | "session_id" | "message" | "parent_tool_use_id"
> & {
  /**
   * Present on every persisted session record but absent from the SDK's
   * declared `SessionMessage` shape, so it is read defensively. Display only —
   * ordering rides on `ordinal`, so its absence costs a timestamp, not order.
   */
  readonly timestamp?: string;
};

function workCategoryForItemType(itemType: ToolLifecycleItemType): AgentTranscriptWorkCategory {
  switch (itemType) {
    case "command_execution":
      return "command";
    case "file_change":
      return "files";
    case "web_search":
      return "search";
    case "collab_agent_tool_call":
      return "delegation";
    default:
      return "tool";
  }
}

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

/**
 * Harness scaffolding the provider persists as ordinary transcript turns.
 *
 * The main chat never sees these — the provider stream does not forward them —
 * but the sub-agent transcript is re-read from the raw session log, where they
 * sit alongside real conversation. Rendering them verbatim buries the actual
 * exchange under multi-page instruction dumps, so they are demoted to compact
 * work rows instead of being shown as things the agent said.
 */
const SKILL_INJECTION_MARKER = "Base directory for this skill:";
const SYSTEM_REMINDER_PATTERN = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

function stripSystemReminders(value: string): string {
  return value.replace(SYSTEM_REMINDER_PATTERN, "").trim();
}

/** The injected skill body leads with the skill slug on its own line. */
function skillInjectionName(value: string): string | undefined {
  if (!value.includes(SKILL_INJECTION_MARKER)) return undefined;
  const first = value.split("\n", 1)[0]?.trim();
  return first !== undefined && first.length > 0 && first.length <= 80 ? first : undefined;
}

/**
 * Blocks per record that `ordinal` reserves, so a record's blocks stay ordered
 * between it and the next record no matter how many it has.
 */
const ORDINAL_BLOCKS_PER_RECORD = 1_000;

/** Absolute position of a block, stable however the transcript is paginated. */
function ordinalFor(recordIndex: number, blockIndex: number): number {
  return (
    recordIndex * ORDINAL_BLOCKS_PER_RECORD + Math.min(blockIndex, ORDINAL_BLOCKS_PER_RECORD - 1)
  );
}

/** Provider timestamps are for display only; ordering rides on `ordinal`. */
function displayTimestamp(candidate: unknown): string | undefined {
  const parsed = typeof candidate === "string" ? Date.parse(candidate) : Number.NaN;
  if (!Number.isFinite(parsed)) return undefined;
  return DateTime.formatIso(DateTime.makeUnsafe(parsed));
}

function toolResultText(content: unknown): string | undefined {
  if (typeof content === "string") return bounded(content);
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap((candidate) => {
    const item = record(candidate);
    const value = item?.type === "text" ? text(item.text) : undefined;
    return value ? [value] : [];
  });
  return parts.length > 0 ? bounded(parts.join("\n\n")) : undefined;
}

/** Pulls the fields the shared renderer treats specially, so tool cards read like the main chat. */
function toolInputFacets(
  itemType: ToolLifecycleItemType,
  input: unknown,
): {
  readonly command?: string;
  readonly changedFiles?: ReadonlyArray<string>;
  readonly detail?: string;
} {
  const args = record(input);
  if (!args) return {};
  const command = text(args.command);
  const filePath = text(args.file_path) ?? text(args.path) ?? text(args.notebook_path);
  if (itemType === "command_execution" && command) {
    return { command, ...(text(args.description) ? { detail: text(args.description)! } : {}) };
  }
  const detail = jsonDetail(input);
  // `changedFiles` means *mutated*, and downstream counts it as such. A `Read`
  // or a `Grep --path` also carries a path, so keying off path presence alone
  // reported a read-only agent as having changed files.
  if (filePath && itemType === "file_change") {
    return { changedFiles: [filePath], ...(detail ? { detail } : {}) };
  }
  return detail ? { detail } : {};
}

export function normalizeClaudeTranscriptMessages(
  messages: ReadonlyArray<TranscriptMessage>,
  /**
   * Message offset of this page within the whole transcript, so `ordinal` is
   * absolute rather than page-relative. Without it page 2 would restart at
   * zero and sort above page 1.
   */
  offset = 0,
): ReadonlyArray<AgentTranscriptItem> {
  const items: Array<AgentTranscriptItem> = [];
  /** Output index of each pending tool call, so its result collapses into it. */
  const toolIndexByUseId = new Map<string, number>();

  let recordIndex = offset;
  for (const message of messages) {
    const currentRecord = recordIndex;
    recordIndex += 1;
    const body = decodeMessageBody(message.message);
    if (Option.isNone(body)) continue;
    const blocks =
      typeof body.value.content === "string"
        ? [{ type: "text", text: body.value.content }]
        : body.value.content;

    let blockIndex = 0;
    for (const candidate of blocks) {
      const id = `${message.uuid}:${blockIndex}`;
      const ordinal = ordinalFor(currentRecord, blockIndex);
      blockIndex += 1;
      const at = displayTimestamp(message.timestamp);

      const textBlock = decodeTextContentBlock(candidate);
      if (Option.isSome(textBlock)) {
        const value = stripSystemReminders(textBlock.value.text);
        if (value.length === 0) continue;
        const skillName = skillInjectionName(value);
        if (skillName) {
          items.push({
            id,
            kind: "work",
            category: "other",
            label: `Loaded skill ${skillName}`,
            status: "completed",
            ordinal,
            ...(at ? { at } : {}),
            ...(bounded(value) ? { detail: bounded(value)! } : {}),
          });
          continue;
        }
        items.push({
          id,
          kind: "message",
          role: message.type,
          text: value,
          ordinal,
          ...(at ? { at } : {}),
        });
        continue;
      }

      const thinkingBlock = decodeThinkingContentBlock(candidate);
      if (Option.isSome(thinkingBlock)) {
        const value = thinkingBlock.value.thinking.trim();
        if (value.length === 0) continue;
        items.push({
          id,
          kind: "work",
          category: "thinking",
          label: "Thinking",
          status: "completed",
          ordinal,
          ...(at ? { at } : {}),
          ...(bounded(value) ? { detail: bounded(value)! } : {}),
        });
        continue;
      }

      const toolUseBlock = decodeToolUseContentBlock(candidate);
      if (Option.isSome(toolUseBlock)) {
        const { id: toolUseId, name, input } = toolUseBlock.value;
        const itemType = classifyToolItemType(name);
        toolIndexByUseId.set(toolUseId, items.length);
        items.push({
          id,
          kind: "work",
          category: workCategoryForItemType(itemType),
          label: name,
          status: "running",
          ordinal,
          ...(at ? { at } : {}),
          toolCallId: toolUseId,
          toolName: name,
          itemType,
          ...toolInputFacets(itemType, input),
        });
        continue;
      }

      const toolResultBlock = decodeToolResultContentBlock(candidate);
      if (Option.isSome(toolResultBlock)) {
        const { tool_use_id: toolUseId, content, is_error: isError } = toolResultBlock.value;
        const outcome = toolResultText(content);
        const status = isError === true ? "failed" : "completed";
        const pendingIndex = toolIndexByUseId.get(toolUseId);
        const pending = pendingIndex === undefined ? undefined : items[pendingIndex];
        if (pendingIndex !== undefined && pending?.kind === "work") {
          items[pendingIndex] = { ...pending, status, ...(outcome ? { outcome } : {}) };
          toolIndexByUseId.delete(toolUseId);
          continue;
        }
        // The call landed on an earlier page; keep the result rather than drop it.
        items.push({
          id,
          kind: "work",
          category: "other",
          label: "Tool result",
          status,
          ordinal,
          ...(at ? { at } : {}),
          toolCallId: toolUseId,
          ...(outcome ? { outcome } : {}),
        });
      }
    }
  }

  return items;
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

/**
 * This reader is the fidelity path for sub-agent detail, so the bound is set to
 * keep a realistic tool payload intact rather than to keep rows short — the
 * renderer collapses long bodies behind a disclosure. It still exists because a
 * page of 100 items crosses the wire in one response.
 */
const TRANSCRIPT_DETAIL_LIMIT = 10_000;

function bounded(value: unknown, limit = TRANSCRIPT_DETAIL_LIMIT): string | undefined {
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

/** Codex exposes reasoning as provider-authored summaries; raw chain-of-thought is encrypted. */
function codexReasoningText(item: UnknownRecord): string | undefined {
  const summary = item.summary;
  if (Array.isArray(summary)) {
    const parts = summary.flatMap((entry) => {
      const value = text(entry) ?? text(record(entry)?.text);
      return value ? [value] : [];
    });
    return parts.length > 0 ? bounded(parts.join("\n\n")) : undefined;
  }
  return bounded(item.text);
}

function codexFileChangeDetail(
  changes: ReadonlyArray<UnknownRecord | undefined>,
): string | undefined {
  const parts = changes.flatMap((change) => {
    if (!change) return [];
    const path = text(change.path);
    if (!path) return [];
    const kind = text(change.kind) ?? text(change.type);
    const diff = text(change.diff) ?? text(change.unifiedDiff);
    const heading = kind ? `${kind}: ${path}` : path;
    return [diff ? `${heading}\n${diff}` : heading];
  });
  return parts.length > 0 ? bounded(parts.join("\n\n")) : undefined;
}

export function normalizeCodexTranscriptItems(
  turns: ProviderThreadSnapshot["turns"],
): ReadonlyArray<AgentTranscriptItem> {
  // Codex hands back the whole child thread rather than a page, so a running
  // counter over its items is already an absolute position.
  let ordinalCounter = 0;
  return turns.flatMap((turn) =>
    turn.items.flatMap((candidate): ReadonlyArray<AgentTranscriptItem> => {
      const item = record(candidate);
      const id = text(item?.id);
      const type = item?.type;
      if (!item || !id || typeof type !== "string") return [];
      const ordinal = ordinalFor(ordinalCounter, 0);
      ordinalCounter += 1;
      const at = displayTimestamp(item.createdAt ?? item.timestamp);

      if (type === "userMessage") {
        const value = userInputText(item.content);
        return value ? [{ id, kind: "message", role: "user", text: value, at } as const] : [];
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
                ordinal,
                ...(at ? { at } : {}),
                ...(item.phase === "final_answer"
                  ? { phase: "final" as const }
                  : item.phase === "commentary"
                    ? { phase: "commentary" as const }
                    : {}),
              } as const,
            ]
          : [];
      }
      if (type === "hookPrompt" || type === "subAgentActivity") return [];
      if (type === "reasoning") {
        // Surfaced as thinking so a Codex sub-agent reads like a Claude one.
        // These are the provider's own summaries — the raw reasoning is
        // encrypted upstream and is not recoverable here.
        const value = codexReasoningText(item);
        return value
          ? [
              {
                id,
                kind: "work",
                category: "thinking",
                label: "Thinking",
                status: "completed",
                ordinal,
                ...(at ? { at } : {}),
                detail: value,
              } as const,
            ]
          : [];
      }
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
        const exitCode = typeof item.exitCode === "number" ? item.exitCode : undefined;
        const output = bounded(item.aggregatedOutput);
        return [
          {
            id,
            kind: "work",
            category: "command",
            label: actionLabel,
            status: exitCode !== undefined && exitCode !== 0 ? "failed" : workStatus(item.status),
            ordinal,
            ...(at ? { at } : {}),
            toolCallId: id,
            itemType: "command_execution",
            ...(bounded(item.command) ? { command: bounded(item.command)! } : {}),
            ...(bounded(item.command) ? { detail: bounded(item.command)! } : {}),
            ...(output ? { outcome: output } : {}),
          } as const,
        ];
      }
      if (type === "fileChange") {
        const changes = Array.isArray(item.changes) ? item.changes.map(record).filter(Boolean) : [];
        const paths = changes.flatMap((change) =>
          text(change?.path) ? [text(change?.path)!] : [],
        );
        const detail = codexFileChangeDetail(changes);
        return [
          {
            id,
            kind: "work",
            category: "files",
            label: `Changed ${paths.length || changes.length} ${paths.length === 1 ? "file" : "files"}`,
            status: workStatus(item.status),
            ordinal,
            ...(at ? { at } : {}),
            toolCallId: id,
            itemType: "file_change",
            ...(paths.length > 0 ? { changedFiles: paths } : {}),
            ...(detail ? { detail } : {}),
          } as const,
        ];
      }
      if (type === "mcpToolCall" || type === "dynamicToolCall") {
        const tool = text(item.tool) ?? "tool";
        const server = type === "mcpToolCall" ? text(item.server) : text(item.namespace);
        const error = record(item.error);
        const failure = bounded(error?.message) ?? bounded(item.error);
        const outcome = failure ?? jsonDetail(item.result);
        return [
          {
            id,
            kind: "work",
            category: "tool",
            label: `Used ${server ? `${server} · ` : ""}${tool}`,
            status: workStatus(item.status),
            ordinal,
            ...(at ? { at } : {}),
            toolCallId: id,
            toolName: tool,
            itemType: type === "mcpToolCall" ? "mcp_tool_call" : "dynamic_tool_call",
            ...(jsonDetail(item.arguments) ? { detail: jsonDetail(item.arguments)! } : {}),
            ...(outcome ? { outcome } : {}),
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
                ordinal,
                ...(at ? { at } : {}),
                toolCallId: id,
                itemType: "web_search",
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
            ordinal,
            ...(at ? { at } : {}),
            toolCallId: id,
            itemType: "collab_agent_tool_call",
            ...(bounded(item.prompt) ? { detail: bounded(item.prompt)! } : {}),
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
                ordinal,
                ...(at ? { at } : {}),
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
  const reader: NonNullable<AgentTranscriptReaderDependencies["getClaudeSubagentMessages"]> =
    dependencies.getClaudeSubagentMessages ?? getSubagentMessages;
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
    items: normalizeClaudeTranscriptMessages(page, offset),
    ...(complete ? {} : { nextCursor: offset + page.length }),
    complete,
    ...(rosterAgent.revision === undefined ? {} : { revision: rosterAgent.revision }),
  };
});
