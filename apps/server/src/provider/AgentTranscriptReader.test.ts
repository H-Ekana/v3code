import { describe, expect, it, vi } from "@effect/vitest";
import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationThread,
  type ProviderSession,
  type ThreadAgentKind,
  type ThreadAgentSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { readAgentTranscript } from "./AgentTranscriptReader.ts";

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

describe("readAgentTranscript", () => {
  it.effect("reads a bounded Claude page and exposes text blocks without thinking blocks", () =>
    Effect.gen(function* () {
      const getMessages = vi.fn(async () => [
        {
          type: "assistant" as const,
          uuid: "message-1",
          session_id: "parent-session-1",
          parent_tool_use_id: "tool-1",
          message: {
            content: [
              { type: "thinking", thinking: "private reasoning" },
              { type: "text", text: "Visible answer" },
            ],
          },
        },
      ]);

      const result = yield* readAgentTranscript(
        {
          threadId,
          sourceProvider: claudeProvider,
          agentId: "agent-1",
          cursor: 4,
          limit: 10,
        },
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
        items: [{ id: "message-1", kind: "message", role: "assistant", text: "Visible answer" }],
        complete: true,
        revision: 7,
      });
      const firstItem = result.status === "available" ? result.items[0] : undefined;
      expect(firstItem?.kind === "message" ? firstItem.text : undefined).not.toContain(
        "private reasoning",
      );
    }),
  );

  it.effect("paginates by provider message offset even when a message has no visible text", () =>
    Effect.gen(function* () {
      const result = yield* readAgentTranscript(
        { threadId, sourceProvider: claudeProvider, agentId: "agent-1", limit: 2 },
        {
          getThread: () => Effect.succeed(Option.some(makeThread(makeAgent()))),
          listSessions: () => Effect.succeed([makeSession()]),
          getClaudeSubagentMessages: async () => [
            {
              type: "assistant",
              uuid: "hidden",
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

      expect(result).toEqual({
        status: "available",
        items: [{ id: "visible", kind: "message", role: "user", text: "Prompt" }],
        nextCursor: 2,
        complete: false,
        revision: 7,
      });
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
      expect(result).toEqual({
        status: "available",
        items: [
          { id: "user-1", kind: "message", role: "user", text: "Review this code" },
          {
            id: "command-1",
            kind: "work",
            category: "command",
            label: "Searched the codebase",
            status: "completed",
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
        ],
        complete: true,
        revision: 7,
      });
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
