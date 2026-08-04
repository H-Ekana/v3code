import { describe, expect, it, vi } from "@effect/vitest";
import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type AgentTranscriptItem,
  type AgentTranscriptResult,
  type OrchestrationThread,
  type ProviderSession,
  type ThreadAgentKind,
  type ThreadAgentSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { normalizeClaudeTranscriptMessages, readAgentTranscript } from "./AgentTranscriptReader.ts";

const threadId = ThreadId.make("thread-1");
const claudeProvider = ProviderDriverKind.make("claudeAgent");
const codexProvider = ProviderDriverKind.make("codex");

function makeAgent(
  provider: ProviderDriverKind = claudeProvider,
  kind: ThreadAgentKind = "subagent",
): ThreadAgentSnapshot {
  return {
    agentId: "agent-1",
    provider,
    kind,
    name: "Researcher",
    status: "running",
    firstStartedAt: "2026-08-01T00:00:00.000Z",
    lastActivityAt: "2026-08-01T00:00:01.000Z",
    activationCount: 1,
    recentActivity: [],
    updatedAt: "2026-08-01T00:00:01.000Z",
  };
}

function makeThread(agent: ThreadAgentSnapshot): OrchestrationThread {
  return {
    id: threadId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-sonnet",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: "C:/workspace",
    latestTurn: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:01.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [
      {
        id: "event-1",
        tone: "info",
        kind: "agent.snapshot",
        summary: "Agent roster",
        payload: { agents: [agent], revision: 7 },
        turnId: null,
        createdAt: "2026-08-01T00:00:01.000Z",
      },
    ],
    checkpoints: [],
    session: null,
  } as unknown as OrchestrationThread;
}

function makeSession(): ProviderSession {
  return {
    provider: claudeProvider,
    status: "ready",
    runtimeMode: "full-access",
    cwd: "C:/workspace",
    threadId,
    resumeCursor: { resume: "parent-session-1" },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:01.000Z",
  };
}

function claudeItems(result: AgentTranscriptResult): ReadonlyArray<AgentTranscriptItem> {
  return result.status === "available" ? result.items : [];
}

function readClaude(
  messages: ReadonlyArray<unknown>,
  request: Partial<Parameters<typeof readAgentTranscript>[0]> = {},
) {
  return readAgentTranscript(
    { threadId, sourceProvider: claudeProvider, agentId: "agent-1", ...request },
    {
      getThread: () => Effect.succeed(Option.some(makeThread(makeAgent()))),
      listSessions: () => Effect.succeed([makeSession()]),
      getClaudeSubagentMessages: async () => messages as never,
    },
  );
}

describe("readAgentTranscript", () => {
  it.effect("preserves interleaved Claude thinking, text, and tool blocks in order", () =>
    Effect.gen(function* () {
      const getMessages = vi.fn(async () => [
        {
          type: "assistant" as const,
          uuid: "message-1",
          session_id: "parent-session-1",
          parent_tool_use_id: "tool-1",
          timestamp: "2026-08-01T00:00:05.000Z",
          message: {
            content: [
              { type: "thinking", thinking: "private reasoning" },
              { type: "text", text: "Visible answer" },
            ],
          },
        },
      ]);

      const result = yield* readAgentTranscript(
        { threadId, sourceProvider: claudeProvider, agentId: "agent-1", cursor: 4, limit: 10 },
        {
          getThread: () => Effect.succeed(Option.some(makeThread(makeAgent()))),
          listSessions: () => Effect.succeed([makeSession()]),
          getClaudeSubagentMessages: getMessages,
        },
      );

      expect(getMessages).toHaveBeenCalledWith("parent-session-1", "agent-1", {
        dir: "C:/workspace",
        limit: 11,
        offset: 4,
      });
      expect(result).toEqual({
        status: "available",
        items: [
          {
            id: "message-1:0",
            kind: "work",
            category: "thinking",
            label: "Thinking",
            status: "completed",
            // Both blocks keep the record's real timestamp — ordering is
            // carried by `ordinal`, which is absolute (page offset 4).
            at: "2026-08-01T00:00:05.000Z",
            ordinal: 4_000,
            detail: "private reasoning",
          },
          {
            id: "message-1:1",
            kind: "message",
            role: "assistant",
            text: "Visible answer",
            at: "2026-08-01T00:00:05.000Z",
            ordinal: 4_001,
          },
        ],
        complete: true,
        revision: 7,
      });
    }),
  );

  it.effect("collapses a Claude tool call and its result into one item", () =>
    Effect.gen(function* () {
      const result = yield* readClaude([
        {
          type: "assistant",
          uuid: "call",
          session_id: "parent-session-1",
          parent_tool_use_id: null,
          message: {
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "Bash",
                input: { command: "pnpm test", description: "Run tests" },
              },
            ],
          },
        },
        {
          type: "user",
          uuid: "result",
          session_id: "parent-session-1",
          parent_tool_use_id: null,
          message: {
            content: [
              { type: "tool_result", tool_use_id: "toolu_1", content: "2 failed", is_error: true },
            ],
          },
        },
      ]);

      expect(claudeItems(result)).toMatchObject([
        {
          id: "call:0",
          kind: "work",
          category: "command",
          label: "Bash",
          status: "failed",
          toolCallId: "toolu_1",
          toolName: "Bash",
          itemType: "command_execution",
          command: "pnpm test",
          detail: "Run tests",
          outcome: "2 failed",
        },
      ]);
    }),
  );

  it("keeps page ordinals absolute so a later page cannot sort into an earlier one", () => {
    const record = (uuid: string, timestamp: string) => ({
      type: "assistant" as const,
      uuid,
      session_id: "s",
      parent_tool_use_id: null,
      timestamp,
      message: { content: [{ type: "text", text: `from ${uuid}` }] },
    });

    // Page 2's record is stamped in the same millisecond as page 1's tail —
    // routine in Claude's log, and the case a timestamp sort gets wrong.
    const pageOne = normalizeClaudeTranscriptMessages([record("a", "2026-08-01T00:00:00.000Z")], 0);
    const pageTwo = normalizeClaudeTranscriptMessages([record("b", "2026-08-01T00:00:00.000Z")], 1);

    expect(pageOne[0]?.ordinal).toBe(0);
    expect(pageTwo[0]?.ordinal).toBe(1_000);
    expect(pageOne[0]!.ordinal!).toBeLessThan(pageTwo[0]!.ordinal!);
  });

  it.effect("reports changed files only for tools that mutate them", () =>
    Effect.gen(function* () {
      const result = yield* readClaude([
        {
          type: "assistant",
          uuid: "calls",
          session_id: "parent-session-1",
          parent_tool_use_id: null,
          message: {
            content: [
              // Reads and searches carry a path too; counting them as changed
              // files reported a read-only agent as having edited the repo.
              { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" } },
              { type: "tool_use", id: "t2", name: "Grep", input: { pattern: "x", path: "src" } },
              { type: "tool_use", id: "t3", name: "Edit", input: { file_path: "b.ts" } },
            ],
          },
        },
      ]);

      const changed = claudeItems(result).flatMap((item) =>
        item.kind === "work" && item.changedFiles ? [...item.changedFiles] : [],
      );
      expect(changed).toEqual(["b.ts"]);
    }),
  );

  it.effect("keeps a tool result whose call landed on an earlier page", () =>
    Effect.gen(function* () {
      const result = yield* readClaude([
        {
          type: "user",
          uuid: "orphan",
          session_id: "parent-session-1",
          parent_tool_use_id: null,
          message: {
            content: [{ type: "tool_result", tool_use_id: "toolu_missing", content: "output" }],
          },
        },
      ]);

      expect(claudeItems(result)).toMatchObject([
        {
          kind: "work",
          label: "Tool result",
          status: "completed",
          toolCallId: "toolu_missing",
          outcome: "output",
        },
      ]);
    }),
  );

  it.effect("demotes injected skill bodies and strips system reminders", () =>
    Effect.gen(function* () {
      const result = yield* readClaude([
        {
          type: "user",
          uuid: "injected",
          session_id: "parent-session-1",
          parent_tool_use_id: null,
          message: {
            content: [
              {
                type: "text",
                text: "codex-cli-runtime\ntrue\nBase directory for this skill: C:/skills\n# Codex Runtime",
              },
              { type: "text", text: "<system-reminder>ignore me</system-reminder>" },
              { type: "text", text: "<system-reminder>noise</system-reminder>\nReal question" },
            ],
          },
        },
      ]);

      expect(claudeItems(result)).toMatchObject([
        { kind: "work", category: "other", label: "Loaded skill codex-cli-runtime" },
        { kind: "message", role: "user", text: "Real question" },
      ]);
    }),
  );

  it.effect("paginates by provider message offset", () =>
    Effect.gen(function* () {
      const result = yield* readAgentTranscript(
        { threadId, sourceProvider: claudeProvider, agentId: "agent-1", limit: 2 },
        {
          getThread: () => Effect.succeed(Option.some(makeThread(makeAgent()))),
          listSessions: () => Effect.succeed([makeSession()]),
          getClaudeSubagentMessages: async () => [
            {
              type: "assistant",
              uuid: "first",
              session_id: "parent-session-1",
              parent_tool_use_id: null,
              message: { content: [{ type: "thinking", thinking: "hidden" }] },
            },
            {
              type: "user",
              uuid: "visible",
              session_id: "parent-session-1",
              parent_tool_use_id: null,
              message: { content: "Prompt" },
            },
            {
              type: "assistant",
              uuid: "next-page",
              session_id: "parent-session-1",
              parent_tool_use_id: null,
              message: { content: "Next" },
            },
          ],
        },
      );

      expect(result).toMatchObject({ nextCursor: 2, complete: false, revision: 7 });
      expect(claudeItems(result)).toMatchObject([
        { id: "first:0", kind: "work", category: "thinking", ordinal: 0 },
        // Ordinals are absolute, so page 2 (offset 2) starts at 2000 and can
        // never sort into this page's tail.
        { id: "visible:0", kind: "message", role: "user", text: "Prompt", ordinal: 1_000 },
      ]);
    }),
  );

  it.effect("reads and normalizes a native Codex child thread", () =>
    Effect.gen(function* () {
      const readCodexAgentThread = vi.fn(() =>
        Effect.succeed({
          threadId: ThreadId.make("agent-1"),
          turns: [
            {
              id: "turn-1" as never,
              items: [
                {
                  id: "user-1",
                  type: "userMessage",
                  content: [{ type: "text", text: "Review this code" }],
                },
                { id: "reasoning-1", type: "reasoning", summary: ["Private reasoning"] },
                {
                  id: "command-1",
                  type: "commandExecution",
                  command: "rg -n TODO src",
                  commandActions: [{ type: "search", command: "rg -n TODO src", query: "TODO" }],
                  status: "completed",
                  aggregatedOutput: "src/a.ts:1: TODO",
                },
                {
                  id: "assistant-1",
                  type: "agentMessage",
                  text: "I found one item.",
                  phase: "final_answer",
                },
              ],
            },
          ],
        }),
      );
      const result = yield* readAgentTranscript(
        { threadId, sourceProvider: codexProvider, agentId: "agent-1" },
        {
          getThread: () => Effect.succeed(Option.some(makeThread(makeAgent(codexProvider)))),
          listSessions: () => Effect.succeed([]),
          readCodexAgentThread,
        },
      );

      expect(readCodexAgentThread).toHaveBeenCalledWith(threadId, "agent-1");
      expect(result).toMatchObject({ status: "available", complete: true, revision: 7 });
      expect(claudeItems(result)).toMatchObject([
        { id: "user-1", kind: "message", role: "user", text: "Review this code" },
        {
          id: "reasoning-1",
          kind: "work",
          category: "thinking",
          label: "Thinking",
          detail: "Private reasoning",
        },
        {
          id: "command-1",
          kind: "work",
          category: "command",
          label: "Searched the codebase",
          status: "completed",
          toolCallId: "command-1",
          itemType: "command_execution",
          command: "rg -n TODO src",
          detail: "rg -n TODO src",
          outcome: "src/a.ts:1: TODO",
        },
        {
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          text: "I found one item.",
          phase: "final",
        },
      ]);
      // Ordering is carried by `ordinal`, not array position or timestamps.
      const ordinals = claudeItems(result).map((item) => item.ordinal ?? -1);
      expect(ordinals).toEqual([...ordinals].sort((left, right) => left - right));
    }),
  );

  it.effect("does not route a request through display delegation identity", () =>
    Effect.gen(function* () {
      const agent = { ...makeAgent(), delegateProvider: codexProvider };
      const result = yield* readAgentTranscript(
        { threadId, sourceProvider: codexProvider, agentId: "agent-1" },
        {
          getThread: () => Effect.succeed(Option.some(makeThread(agent))),
          listSessions: () => Effect.succeed([makeSession()]),
        },
      );

      expect(result).toMatchObject({ status: "not-found", reason: "provider-mismatch" });
    }),
  );
});
