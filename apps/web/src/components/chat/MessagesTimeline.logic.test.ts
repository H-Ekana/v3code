import { describe, expect, it } from "vite-plus/test";
import {
  advanceTimelineLifecycle,
  computeStableMessagesTimelineRows,
  computeMessageDurationStart,
  deriveMessagesTimelineRows,
  EMPTY_TIMELINE_LIFECYCLE_LEDGER,
  expireTimelineLifecycleOneShots,
  isRunningToolWorkEntry,
  normalizeCompactToolLabel,
  resolveAssistantMessageCopyState,
  resolveTimelineSettleFold,
  resolveWorkEntryToolStatus,
  TIMELINE_ONE_SHOT_TTL_MS,
  timelineLifecycleHasOneShots,
  type MessagesTimelineRow,
  type TimelineLifecycleLedger,
} from "./MessagesTimeline.logic";
import type { WorkLogEntry } from "../../session-logic";

describe("computeMessageDurationStart", () => {
  it("returns message createdAt when there is no preceding user message", () => {
    const result = computeMessageDurationStart([
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:05Z",
        updatedAt: "2026-01-01T00:00:10Z",
        streaming: false,
      },
    ]);
    expect(result).toEqual(new Map([["a1", "2026-01-01T00:00:05Z"]]));
  });

  it("uses the user message createdAt for the first assistant response", () => {
    const result = computeMessageDurationStart([
      {
        id: "u1",
        role: "user",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        streaming: false,
      },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        updatedAt: "2026-01-01T00:00:30Z",
        streaming: false,
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("uses the previous completed assistant updatedAt for subsequent assistant responses", () => {
    const result = computeMessageDurationStart([
      {
        id: "u1",
        role: "user",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        streaming: false,
      },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        updatedAt: "2026-01-01T00:00:30Z",
        streaming: false,
      },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        updatedAt: "2026-01-01T00:00:55Z",
        streaming: false,
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:30Z"],
      ]),
    );
  });

  it("does not advance the boundary for a streaming message", () => {
    const result = computeMessageDurationStart([
      {
        id: "u1",
        role: "user",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        streaming: false,
      },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        updatedAt: "2026-01-01T00:00:40Z",
        streaming: true,
      },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        updatedAt: "2026-01-01T00:00:55Z",
        streaming: false,
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("resets the boundary on a new user message", () => {
    const result = computeMessageDurationStart([
      {
        id: "u1",
        role: "user",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        streaming: false,
      },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        updatedAt: "2026-01-01T00:00:30Z",
        streaming: false,
      },
      {
        id: "u2",
        role: "user",
        createdAt: "2026-01-01T00:01:00Z",
        updatedAt: "2026-01-01T00:01:00Z",
        streaming: false,
      },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:01:20Z",
        updatedAt: "2026-01-01T00:01:20Z",
        streaming: false,
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["u2", "2026-01-01T00:01:00Z"],
        ["a2", "2026-01-01T00:01:00Z"],
      ]),
    );
  });

  it("handles system messages without affecting the boundary", () => {
    const result = computeMessageDurationStart([
      {
        id: "u1",
        role: "user",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        streaming: false,
      },
      {
        id: "s1",
        role: "system",
        createdAt: "2026-01-01T00:00:01Z",
        updatedAt: "2026-01-01T00:00:01Z",
        streaming: false,
      },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        updatedAt: "2026-01-01T00:00:30Z",
        streaming: false,
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["s1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("returns empty map for empty input", () => {
    expect(computeMessageDurationStart([])).toEqual(new Map());
  });
});

describe("normalizeCompactToolLabel", () => {
  it("removes trailing completion wording from command labels", () => {
    expect(normalizeCompactToolLabel("Ran command complete")).toBe("Ran command");
  });

  it("removes trailing completion wording from other labels", () => {
    expect(normalizeCompactToolLabel("Read file completed")).toBe("Read file");
  });
});

describe("resolveAssistantMessageCopyState", () => {
  it("returns enabled copy state for completed assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "Ship it",
        streaming: false,
      }),
    ).toEqual({
      text: "Ship it",
      visible: true,
    });
  });

  it("hides copy while an assistant message is still streaming", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "Still streaming",
        streaming: true,
      }),
    ).toEqual({
      text: "Still streaming",
      visible: false,
    });
  });

  it("hides copy for empty completed assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "   ",
        streaming: false,
      }),
    ).toEqual({
      text: null,
      visible: false,
    });
  });

  it("hides copy for non-terminal assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: false,
        text: "Interim thought",
        streaming: false,
      }),
    ).toEqual({
      text: "Interim thought",
      visible: false,
    });
  });
});

describe("deriveMessagesTimelineRows", () => {
  it("only enables assistant copy for the terminal assistant message in a turn", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-1-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Write a poem",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "I should ground this first.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            updatedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
        {
          id: "assistant-final-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-final" as never,
            role: "assistant",
            text: "Here is the poem.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            updatedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      expandedTurnIds: new Set(["turn-1" as never]),
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(assistantRows).toHaveLength(2);
    expect(assistantRows[0]?.showAssistantCopyButton).toBe(false);
    expect(assistantRows[1]?.showAssistantCopyButton).toBe(true);
  });

  it("marks only the active assistant turn as streaming for copy controls", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "assistant-one-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-one" as never,
            role: "assistant",
            text: "Earlier response.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            updatedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
        {
          id: "assistant-two-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-two" as never,
            role: "assistant",
            text: "Active response.",
            turnId: "turn-2" as never,
            createdAt: "2026-01-01T00:00:20Z",
            updatedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-2" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:19Z",
        completedAt: null,
      },
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(assistantRows[0]?.assistantCopyStreaming).toBe(false);
    expect(assistantRows[1]?.assistantCopyStreaming).toBe(true);
  });

  it("projects assistant diff summaries and user revert counts onto the affected rows", () => {
    const assistantTurnDiffSummary = {
      turnId: "turn-1" as never,
      completedAt: "2026-01-01T00:00:30Z",
      assistantMessageId: "assistant-1" as never,
      checkpointTurnCount: 2,
      checkpointRef: "checkpoint-1" as never,
      status: "ready" as const,
      files: [{ path: "src/index.ts", kind: "modified", additions: 3, deletions: 1 }],
    };

    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Do the thing",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-1" as never,
            role: "assistant",
            text: "Done",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            updatedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map([
        ["assistant-1" as never, assistantTurnDiffSummary],
      ]),
      revertTurnCountByUserMessageId: new Map([["user-1" as never, 1]]),
    });

    const userRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "user",
    );
    const assistantRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(userRow?.revertTurnCount).toBe(1);
    expect(assistantRow?.assistantTurnDiffSummary).toBe(assistantTurnDiffSummary);
  });

  it("folds settled-turn commentary and work behind a Worked-for row", () => {
    const timelineEntries = [
      {
        id: "user-entry",
        kind: "message" as const,
        createdAt: "2026-01-01T00:00:00Z",
        message: {
          id: "user-1" as never,
          role: "user" as const,
          text: "Build it",
          turnId: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          streaming: false,
        },
      },
      {
        id: "assistant-thought-entry",
        kind: "message" as const,
        createdAt: "2026-01-01T00:00:05Z",
        message: {
          id: "assistant-thought" as never,
          role: "assistant" as const,
          text: "Looking around first.",
          turnId: "turn-1" as never,
          createdAt: "2026-01-01T00:00:05Z",
          updatedAt: "2026-01-01T00:00:06Z",
          streaming: false,
        },
      },
      {
        id: "work-entry-1",
        kind: "work" as const,
        createdAt: "2026-01-01T00:00:08Z",
        entry: {
          id: "work-1",
          createdAt: "2026-01-01T00:00:08Z",
          turnId: "turn-1" as never,
          label: "Ran command",
          tone: "tool" as const,
        },
      },
      {
        id: "assistant-final-entry",
        kind: "message" as const,
        createdAt: "2026-01-01T00:00:20Z",
        message: {
          id: "assistant-final" as never,
          role: "assistant" as const,
          text: "Done",
          turnId: "turn-1" as never,
          createdAt: "2026-01-01T00:00:20Z",
          updatedAt: "2026-01-01T00:00:22Z",
          streaming: false,
        },
      },
    ];

    const collapsedRows = deriveMessagesTimelineRows({
      timelineEntries,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const foldRow = collapsedRows.find(
      (row): row is Extract<(typeof collapsedRows)[number], { kind: "turn-fold" }> =>
        row.kind === "turn-fold",
    );
    expect(foldRow?.turnId).toBe("turn-1");
    expect(foldRow?.expanded).toBe(false);
    // User message boundary (00:00:00) → terminal message updatedAt (00:00:22).
    expect(foldRow?.label).toBe("Worked for 22s");
    expect(collapsedRows.map((row) => row.id)).toEqual([
      "user-entry",
      "turn-fold:turn-1",
      "assistant-final-entry",
    ]);

    const expandedRows = deriveMessagesTimelineRows({
      timelineEntries,
      expandedTurnIds: new Set(["turn-1" as never]),
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(expandedRows.map((row) => row.id)).toEqual([
      "user-entry",
      "turn-fold:turn-1",
      "assistant-thought-entry",
      "work-entry-1",
      "assistant-final-entry",
    ]);
    expect(
      expandedRows.find((row) => row.kind === "turn-fold" && row.expanded === true),
    ).toBeDefined();
  });

  it("derives a sane duration for a steer-superseded turn with one instant commentary message", () => {
    // A steer ends the previous turn early: its only message completes the
    // instant it is created, and trailing work entries land after it. The
    // fold duration must span from the user message that started the turn to
    // the last entry, not message createdAt → message updatedAt (~0ms).
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user" as const,
            text: "do it once more",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-commentary-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:09Z",
          message: {
            id: "assistant-commentary" as never,
            role: "assistant" as const,
            text: "Kicking off call 1.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:09Z",
            updatedAt: "2026-01-01T00:00:09Z",
            streaming: false,
          },
        },
        {
          id: "work-entry-1",
          kind: "work",
          createdAt: "2026-01-01T00:00:12Z",
          entry: {
            id: "work-1",
            createdAt: "2026-01-01T00:00:12Z",
            turnId: "turn-1" as never,
            label: "Ran command",
            tone: "tool" as const,
          },
        },
        {
          id: "steer-user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:14Z",
          message: {
            id: "user-2" as never,
            role: "user" as const,
            text: "actually do 15",
            turnId: null,
            createdAt: "2026-01-01T00:00:14Z",
            updatedAt: "2026-01-01T00:00:14Z",
            streaming: false,
          },
        },
        {
          id: "assistant-next-turn-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:17Z",
          message: {
            id: "assistant-next" as never,
            role: "assistant" as const,
            text: "One down — adjusting.",
            turnId: "turn-2" as never,
            createdAt: "2026-01-01T00:00:17Z",
            updatedAt: "2026-01-01T00:00:17Z",
            streaming: true,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-2" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:14Z",
        completedAt: null,
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:14Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const foldRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "turn-fold" }> =>
        row.kind === "turn-fold",
    );
    // User message (00:00:00) → trailing work entry (00:00:12).
    expect(foldRow?.turnId).toBe("turn-1");
    expect(foldRow?.label).toBe("Worked for 12s");
  });

  it("uses latest-turn timings and the stopped label for an interrupted latest turn", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "work-entry-1",
          kind: "work",
          createdAt: "2026-01-01T00:00:05Z",
          entry: {
            id: "work-1",
            createdAt: "2026-01-01T00:00:05Z",
            turnId: "turn-1" as never,
            label: "Ran command",
            tone: "tool" as const,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "interrupted",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:00:47Z",
      },
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "turn-fold",
        turnId: "turn-1",
        label: "You stopped after 47s",
        expanded: false,
      }),
      // The interrupted turn also settles into an explicit trailing state
      // rather than the response simply stopping with no explanation.
      expect.objectContaining({
        kind: "interrupted",
        id: "interrupted-indicator-row",
        turnId: "turn-1",
        createdAt: "2026-01-01T00:00:47Z",
      }),
    ]);
  });

  it("keeps the previous turn folded while a newly sent message awaits its turn", () => {
    // Right after send, isWorking is true but latestTurn still points at the
    // previous, settled turn — it must stay folded through that window.
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "work-entry-1",
          kind: "work",
          createdAt: "2026-01-01T00:00:05Z",
          entry: {
            id: "work-1",
            createdAt: "2026-01-01T00:00:05Z",
            turnId: "turn-1" as never,
            label: "Ran command",
            tone: "tool" as const,
          },
        },
        {
          id: "assistant-final-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-final" as never,
            role: "assistant",
            text: "Done",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            updatedAt: "2026-01-01T00:00:22Z",
            streaming: false,
          },
        },
        {
          id: "user-followup-entry",
          kind: "message",
          createdAt: "2026-01-01T00:01:00Z",
          message: {
            id: "user-followup" as never,
            role: "user",
            text: "yooo",
            turnId: null,
            createdAt: "2026-01-01T00:01:00Z",
            updatedAt: "2026-01-01T00:01:00Z",
            streaming: false,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "completed",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:00:22Z",
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:01:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.map((row) => row.id)).toEqual([
      "turn-fold:turn-1",
      "assistant-final-entry",
      "user-followup-entry",
      "working-indicator-row",
    ]);
    const finalRow = rows.find((row) => row.id === "assistant-final-entry");
    expect(finalRow?.kind === "message" && finalRow.showAssistantMeta).toBe(true);
  });

  it("does not fold the active in-progress turn", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:05Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "Working on it.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:05Z",
            updatedAt: "2026-01-01T00:00:06Z",
            streaming: false,
          },
        },
        {
          id: "work-entry-1",
          kind: "work",
          createdAt: "2026-01-01T00:00:08Z",
          entry: {
            id: "work-1",
            createdAt: "2026-01-01T00:00:08Z",
            turnId: "turn-1" as never,
            label: "Ran command",
            tone: "tool" as const,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: null,
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.some((row) => row.kind === "turn-fold")).toBe(false);
    expect(rows.map((row) => row.id)).toEqual([
      "assistant-thought-entry",
      "work-entry-1",
      "working-indicator-row",
    ]);
  });

  it("does not fold the session's running turn when latestTurn regresses", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "previous-work-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:05Z",
          entry: {
            id: "previous-work",
            createdAt: "2026-01-01T00:00:05Z",
            turnId: "turn-1" as never,
            label: "Read files",
            tone: "tool" as const,
          },
        },
        {
          id: "user-followup-entry",
          kind: "message",
          createdAt: "2026-01-01T00:01:00Z",
          message: {
            id: "user-followup" as never,
            role: "user",
            text: "continue",
            turnId: null,
            createdAt: "2026-01-01T00:01:00Z",
            updatedAt: "2026-01-01T00:01:00Z",
            streaming: false,
          },
        },
        {
          id: "running-work-entry",
          kind: "work",
          createdAt: "2026-01-01T00:01:05Z",
          entry: {
            id: "running-work",
            createdAt: "2026-01-01T00:01:05Z",
            turnId: "turn-2" as never,
            label: "Searched files",
            tone: "tool" as const,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "completed",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:00:25Z",
      },
      runningTurnId: "turn-2" as never,
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:01:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.filter((row) => row.kind === "turn-fold").map((row) => row.turnId)).toEqual([
      "turn-1",
    ]);
    expect(rows.map((row) => row.id)).toContain("running-work-entry");
  });

  it("only shows assistant metadata on the terminal assistant message", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "Checking first.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            updatedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
        {
          id: "assistant-final-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-final" as never,
            role: "assistant",
            text: "Done.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            updatedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      expandedTurnIds: new Set(["turn-1" as never]),
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(assistantRows.map((row) => row.showAssistantMeta)).toEqual([false, true]);
  });

  it("withholds assistant metadata while the active turn is still in progress", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "Working on it.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            updatedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: null,
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const assistantRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(assistantRow?.showAssistantMeta).toBe(false);
    expect(assistantRow?.showAssistantCopyButton).toBe(false);
  });

  it("models work log overflow expansion as inserted list rows", () => {
    const timelineEntries = [
      {
        id: "work-entry-1",
        kind: "work" as const,
        createdAt: "2026-01-01T00:00:01Z",
        entry: {
          id: "work-1",
          createdAt: "2026-01-01T00:00:01Z",
          label: "read",
          detail: "Reading package.json",
          tone: "tool" as const,
        },
      },
      {
        id: "work-entry-2",
        kind: "work" as const,
        createdAt: "2026-01-01T00:00:02Z",
        entry: {
          id: "work-2",
          createdAt: "2026-01-01T00:00:02Z",
          label: "edit",
          detail: "Editing MessagesTimeline.tsx",
          tone: "tool" as const,
        },
      },
      {
        id: "work-entry-3",
        kind: "work" as const,
        createdAt: "2026-01-01T00:00:03Z",
        entry: {
          id: "work-3",
          createdAt: "2026-01-01T00:00:03Z",
          label: "test",
          detail: "Running tests",
          tone: "tool" as const,
        },
      },
    ];

    const baseInput = {
      timelineEntries,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    };
    const collapsedRows = deriveMessagesTimelineRows(baseInput);
    const expandedRows = deriveMessagesTimelineRows({
      ...baseInput,
      expandedWorkGroupIds: new Set(["work-group:work-entry-1"]),
    });

    expect(collapsedRows.map((row) => row.id)).toEqual(["work-3", "work-toggle:work-entry-1"]);
    expect(collapsedRows.find((row) => row.kind === "work-toggle")).toMatchObject({
      groupId: "work-group:work-entry-1",
      hiddenCount: 2,
      expanded: false,
      onlyToolEntries: true,
    });
    expect(expandedRows.map((row) => row.id)).toEqual([
      "work-1",
      "work-2",
      "work-3",
      "work-toggle:work-entry-1",
    ]);
    expect(expandedRows.find((row) => row.kind === "work-toggle")).toMatchObject({
      expanded: true,
    });
  });
});

describe("computeStableMessagesTimelineRows", () => {
  it("returns the previous result when row order and content are unchanged", () => {
    const firstUserMessage = {
      id: "user-1" as never,
      role: "user" as const,
      text: "First",
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      streaming: false,
    };
    const secondUserMessage = {
      id: "user-2" as never,
      role: "user" as const,
      text: "Second",
      turnId: null,
      createdAt: "2026-01-01T00:00:10Z",
      updatedAt: "2026-01-01T00:00:10Z",
      streaming: false,
    };

    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "entry-user-1",
          kind: "message",
          createdAt: firstUserMessage.createdAt,
          message: firstUserMessage,
        },
        {
          id: "entry-user-2",
          kind: "message",
          createdAt: secondUserMessage.createdAt,
          message: secondUserMessage,
        },
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const initial = computeStableMessagesTimelineRows(rows, {
      byId: new Map(),
      result: [],
    });

    const repeated = computeStableMessagesTimelineRows(rows, initial);

    expect(repeated).toBe(initial);
    expect(repeated.result).toBe(initial.result);
  });

  it("reuses work rows when equivalent timeline derivations create new grouped arrays", () => {
    const firstWorkEntry = {
      id: "work-1",
      createdAt: "2026-01-01T00:00:00Z",
      label: "thinking",
      detail: "Inspecting repository state",
      tone: "thinking" as const,
    };
    const secondWorkEntry = {
      id: "work-2",
      createdAt: "2026-01-01T00:00:01Z",
      label: "read",
      detail: "Reading package.json",
      tone: "tool" as const,
    };

    const createRows = () =>
      deriveMessagesTimelineRows({
        timelineEntries: [
          {
            id: "entry-work-1",
            kind: "work",
            createdAt: firstWorkEntry.createdAt,
            entry: firstWorkEntry,
          },
          {
            id: "entry-work-2",
            kind: "work",
            createdAt: secondWorkEntry.createdAt,
            entry: secondWorkEntry,
          },
        ],
        isWorking: false,
        activeTurnStartedAt: null,
        turnDiffSummaryByAssistantMessageId: new Map(),
        revertTurnCountByUserMessageId: new Map(),
      });

    const firstRows = createRows();
    const initial = computeStableMessagesTimelineRows(firstRows, {
      byId: new Map(),
      result: [],
    });
    const secondRows = createRows();

    expect(secondRows[0]).not.toBe(firstRows[0]);

    const repeated = computeStableMessagesTimelineRows(secondRows, initial);

    expect(repeated).toBe(initial);
    expect(repeated.result[0]).toBe(initial.result[0]);
  });

  it("returns a new result when row order changes without content changes", () => {
    const firstUserMessage = {
      id: "user-1" as never,
      role: "user" as const,
      text: "First",
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      streaming: false,
    };
    const secondUserMessage = {
      id: "user-2" as never,
      role: "user" as const,
      text: "Second",
      turnId: null,
      createdAt: "2026-01-01T00:00:10Z",
      updatedAt: "2026-01-01T00:00:10Z",
      streaming: false,
    };

    const firstRows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "entry-user-1",
          kind: "message",
          createdAt: firstUserMessage.createdAt,
          message: firstUserMessage,
        },
        {
          id: "entry-user-2",
          kind: "message",
          createdAt: secondUserMessage.createdAt,
          message: secondUserMessage,
        },
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const initial = computeStableMessagesTimelineRows(firstRows, {
      byId: new Map(),
      result: [],
    });

    const reordered = computeStableMessagesTimelineRows([firstRows[1]!, firstRows[0]!], initial);

    expect(reordered).not.toBe(initial);
    expect(reordered.result).toEqual([initial.result[1], initial.result[0]]);
  });
});

// ---------------------------------------------------------------------------
// One-shot lifecycle ledger (plan items 5, 6, 10)
//
// These are the replay-prevention tests. The timeline is virtualized, so a row
// mounting is not a lifecycle event — every case below is a way the UI can make
// old content look new (remount, rehydrate, expand a fold, return to a thread)
// and must therefore stay silent.
// ---------------------------------------------------------------------------

const LIFECYCLE_AT = "2026-05-04T10:00:00.000Z";
const RUNNING_TURN = "turn-1" as never;

function userRow(id: string): MessagesTimelineRow {
  return {
    kind: "message",
    id: `row:${id}`,
    createdAt: LIFECYCLE_AT,
    message: {
      id: id as never,
      role: "user",
      text: `prompt ${id}`,
      turnId: null,
      createdAt: LIFECYCLE_AT,
      updatedAt: LIFECYCLE_AT,
      streaming: false,
    },
    durationStart: LIFECYCLE_AT,
    showAssistantMeta: false,
    showAssistantCopyButton: false,
    assistantCopyStreaming: false,
  };
}

function assistantRow(id: string, streaming: boolean): MessagesTimelineRow {
  return {
    kind: "message",
    id: `row:${id}`,
    createdAt: LIFECYCLE_AT,
    message: {
      id: id as never,
      role: "assistant",
      text: `answer ${id}`,
      turnId: RUNNING_TURN,
      createdAt: LIFECYCLE_AT,
      updatedAt: LIFECYCLE_AT,
      streaming,
    },
    durationStart: LIFECYCLE_AT,
    showAssistantMeta: !streaming,
    showAssistantCopyButton: !streaming,
    assistantCopyStreaming: streaming,
  };
}

function toolRow(id: string, overrides: Partial<WorkLogEntry> = {}): MessagesTimelineRow {
  return {
    kind: "work",
    id: `row:${id}`,
    createdAt: LIFECYCLE_AT,
    groupedEntries: [
      {
        id,
        createdAt: LIFECYCLE_AT,
        label: "Bash",
        tone: "tool",
        turnId: RUNNING_TURN,
        ...overrides,
      },
    ],
  };
}

function advance(
  rows: MessagesTimelineRow[],
  previous: TimelineLifecycleLedger,
  options: {
    threadKey?: string;
    unsettledTurnId?: never;
    interruptedTurnId?: never;
    now?: number;
  } = {},
) {
  return advanceTimelineLifecycle(
    {
      rows,
      threadKey: options.threadKey ?? "env:thread-1",
      unsettledTurnId: options.unsettledTurnId ?? null,
      interruptedTurnId: options.interruptedTurnId ?? null,
      now: options.now ?? 1_000,
    },
    previous,
  );
}

describe("resolveWorkEntryToolStatus", () => {
  it("only treats an in-progress tool call as running while its turn is unsettled", () => {
    const entry: WorkLogEntry = {
      id: "tool-1",
      createdAt: LIFECYCLE_AT,
      label: "Bash",
      tone: "tool",
      turnId: RUNNING_TURN,
      toolLifecycleStatus: "inProgress",
    };

    expect(resolveWorkEntryToolStatus(entry, RUNNING_TURN)).toBe("running");
    expect(isRunningToolWorkEntry(entry, RUNNING_TURN)).toBe(true);
    // Turn is over: a leftover inProgress entry is stale history, not a live
    // spinner that should keep turning in restored scrollback.
    expect(resolveWorkEntryToolStatus(entry, null)).toBe("neutral");
    expect(isRunningToolWorkEntry(entry, null)).toBe(false);
    expect(resolveWorkEntryToolStatus(entry, "turn-9" as never)).toBe("neutral");
  });

  it("classifies the remaining lifecycle faces", () => {
    const base = { id: "t", createdAt: LIFECYCLE_AT, label: "Bash", tone: "tool" } as const;

    expect(resolveWorkEntryToolStatus({ ...base, detail: "ok" }, null)).toBe("success");
    expect(resolveWorkEntryToolStatus({ ...base, toolLifecycleStatus: "failed" }, null)).toBe(
      "failure",
    );
    expect(resolveWorkEntryToolStatus({ ...base, detail: "ENOENT" }, RUNNING_TURN)).toBe("failure");
    expect(resolveWorkEntryToolStatus({ ...base, toolLifecycleStatus: "stopped" }, null)).toBe(
      "neutral",
    );
    // Not tool-like: a plain info log owns no completion semantics and must not
    // borrow a success check.
    expect(
      resolveWorkEntryToolStatus(
        { id: "t", createdAt: LIFECYCLE_AT, label: "Context compacted", tone: "info" },
        null,
      ),
    ).toBe("none");
  });
});

describe("deriveMessagesTimelineRows tool visibility", () => {
  function rowsForInProgressTool(unsettled: boolean) {
    return deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "entry-tool",
          kind: "work",
          createdAt: LIFECYCLE_AT,
          entry: {
            id: "tool-1",
            createdAt: LIFECYCLE_AT,
            label: "Bash",
            tone: "tool",
            turnId: RUNNING_TURN,
            toolLifecycleStatus: "inProgress",
          },
        },
      ],
      latestTurn: unsettled
        ? { turnId: RUNNING_TURN, state: "running", startedAt: LIFECYCLE_AT, completedAt: null }
        : {
            turnId: RUNNING_TURN,
            state: "completed",
            startedAt: LIFECYCLE_AT,
            completedAt: LIFECYCLE_AT,
          },
      runningTurnId: unsettled ? RUNNING_TURN : null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });
  }

  it("shows a live tool call while its turn runs and hides it once the turn settles", () => {
    expect(rowsForInProgressTool(true).map((row) => row.kind)).toEqual(["work"]);
    // Settled with no outcome: back to the pre-existing "hide empty rows"
    // behaviour, so restored history renders exactly as it did before — only
    // the turn's own fold row remains.
    expect(rowsForInProgressTool(false).map((row) => row.kind)).toEqual(["turn-fold"]);
  });
});

describe("advanceTimelineLifecycle replay prevention", () => {
  it("treats the first snapshot of a thread as history and animates none of it", () => {
    const ledger = advance(
      [
        userRow("user-1"),
        toolRow("tool-1", { detail: "done" }),
        assistantRow("assistant-1", false),
      ],
      EMPTY_TIMELINE_LIFECYCLE_LEDGER,
    );

    expect(timelineLifecycleHasOneShots(ledger)).toBe(false);
    expect(ledger.liveEdgeMessageId).toBeNull();
    expect(ledger.hydrated).toBe(true);
  });

  it("emits exactly one arrival for a newly sent user turn", () => {
    const history = [userRow("user-1"), assistantRow("assistant-1", false)];
    const hydrated = advance(history, EMPTY_TIMELINE_LIFECYCLE_LEDGER);

    const sent = advance([...history, userRow("user-2")], hydrated);

    expect([...sent.arrivingUserMessageIds]).toEqual(["user-2"]);
  });

  it("is inert when re-advanced over the same snapshot — the virtualized remount case", () => {
    const hydrated = advance([userRow("user-1")], EMPTY_TIMELINE_LIFECYCLE_LEDGER);
    const nextRows = [userRow("user-1"), userRow("user-2")];
    const sent = advance(nextRows, hydrated);

    // Same rows identity, same thread: scroll away and back, a React double
    // render, or a re-render from unrelated state must not re-emit.
    expect(advance(nextRows, sent, { now: 1_010 })).toBe(sent);
  });

  it("expires the one-shot instead of leaving it armed for a later remount", () => {
    const hydrated = advance([userRow("user-1")], EMPTY_TIMELINE_LIFECYCLE_LEDGER);
    const nextRows = [userRow("user-1"), userRow("user-2")];
    const sent = advance(nextRows, hydrated);
    expect(sent.arrivingUserMessageIds.has("user-2")).toBe(true);

    const later = advance(nextRows, sent, { now: 1_000 + TIMELINE_ONE_SHOT_TTL_MS });
    expect(timelineLifecycleHasOneShots(later)).toBe(false);

    // The same content re-derived later (a streaming tick, a fold toggle) stays
    // quiet, because the identity was marked seen when it was emitted.
    const rederived = advance([userRow("user-1"), userRow("user-2")], later, { now: 9_000 });
    expect(timelineLifecycleHasOneShots(rederived)).toBe(false);
  });

  it("never animates history restored by switching threads and coming back", () => {
    const hydrated = advance([userRow("user-1")], EMPTY_TIMELINE_LIFECYCLE_LEDGER);
    const sent = advance([userRow("user-1"), userRow("user-2")], hydrated);
    expect(timelineLifecycleHasOneShots(sent)).toBe(true);

    const otherThread = advance([userRow("other-1")], sent, { threadKey: "env:thread-2" });
    expect(timelineLifecycleHasOneShots(otherThread)).toBe(false);

    // Back to the original thread: the whole conversation, including the turn
    // that animated a moment ago, re-hydrates silently.
    const back = advance([userRow("user-1"), userRow("user-2")], otherThread, {
      threadKey: "env:thread-1",
    });
    expect(timelineLifecycleHasOneShots(back)).toBe(false);
  });

  it("records a backfilled batch of older user turns without animating them", () => {
    const hydrated = advance([userRow("user-9")], EMPTY_TIMELINE_LIFECYCLE_LEDGER);

    // A turn-fold or work-group expansion inserts older turns above the newest
    // one. Only the newest user turn is ever eligible, and it is already seen.
    const expandedFold = advance(
      [userRow("user-6"), userRow("user-7"), userRow("user-8"), userRow("user-9")],
      hydrated,
    );

    expect(timelineLifecycleHasOneShots(expandedFold)).toBe(false);
  });

  it("keeps the live edge on the newest streaming message and drops it immediately", () => {
    const hydrated = advance([userRow("user-1")], EMPTY_TIMELINE_LIFECYCLE_LEDGER);

    const streaming = advance([userRow("user-1"), assistantRow("assistant-1", true)], hydrated);
    expect(streaming.liveEdgeMessageId).toBe("assistant-1");

    // A newer stream starts: the older one loses the edge on the same tick.
    const twoStreams = advance(
      [userRow("user-1"), assistantRow("assistant-1", true), assistantRow("assistant-2", true)],
      streaming,
    );
    expect(twoStreams.liveEdgeMessageId).toBe("assistant-2");

    const settled = advance(
      [userRow("user-1"), assistantRow("assistant-1", true), assistantRow("assistant-2", false)],
      twoStreams,
    );
    expect(settled.liveEdgeMessageId).toBe("assistant-1");
  });

  it("glints once when a stream it watched resolves, and never for history", () => {
    const hydrated = advance([userRow("user-1")], EMPTY_TIMELINE_LIFECYCLE_LEDGER);
    const streaming = advance([userRow("user-1"), assistantRow("assistant-1", true)], hydrated);

    const resolved = advance([userRow("user-1"), assistantRow("assistant-1", false)], streaming);
    expect([...resolved.resolvingStreamMessageIds]).toEqual(["assistant-1"]);

    const expired = expireTimelineLifecycleOneShots(resolved);
    // Re-deriving the same settled message (remount, fold expand, scroll
    // restore) must not glint again.
    const again = advance([userRow("user-1"), assistantRow("assistant-1", false)], expired, {
      now: 9_000,
    });
    expect(again.resolvingStreamMessageIds.size).toBe(0);
  });

  it("never glints when a stream is interrupted instead of completing", () => {
    const hydrated = advance([userRow("user-1")], EMPTY_TIMELINE_LIFECYCLE_LEDGER);
    const streaming = advance([userRow("user-1"), assistantRow("assistant-1", true)], hydrated);
    expect(streaming.liveEdgeMessageId).toBe("assistant-1");

    // The user pressed stop: the turn settles as interrupted. An interruption
    // is not a completion — no glint, and the live edge goes immediately.
    const interrupted = advance(
      [userRow("user-1"), assistantRow("assistant-1", false)],
      streaming,
      { interruptedTurnId: RUNNING_TURN },
    );

    expect(interrupted.resolvingStreamMessageIds.size).toBe(0);
    expect(interrupted.liveEdgeMessageId).toBeNull();

    // And it cannot glint later either, once the interrupted flag is gone from
    // the input (e.g. a newer turn becomes the latest turn).
    const afterwards = advance(
      [userRow("user-1"), assistantRow("assistant-1", false)],
      interrupted,
      { now: 9_000 },
    );
    expect(afterwards.resolvingStreamMessageIds.size).toBe(0);
  });

  it("drops the live edge even if an interrupted message is left flagged as streaming", () => {
    const hydrated = advance([userRow("user-1")], EMPTY_TIMELINE_LIFECYCLE_LEDGER);
    const streaming = advance([userRow("user-1"), assistantRow("assistant-1", true)], hydrated);

    const interrupted = advance([userRow("user-1"), assistantRow("assistant-1", true)], streaming, {
      interruptedTurnId: RUNNING_TURN,
    });

    expect(interrupted.liveEdgeMessageId).toBeNull();
    expect(interrupted.resolvingStreamMessageIds.size).toBe(0);
  });

  it("does not glint for an assistant message that arrives already settled", () => {
    const hydrated = advance([userRow("user-1")], EMPTY_TIMELINE_LIFECYCLE_LEDGER);

    const appended = advance([userRow("user-1"), assistantRow("assistant-1", false)], hydrated);

    expect(appended.resolvingStreamMessageIds.size).toBe(0);
  });

  it("flashes a tool exactly once on running to success", () => {
    const hydrated = advance([userRow("user-1")], EMPTY_TIMELINE_LIFECYCLE_LEDGER);
    const running = advance(
      [userRow("user-1"), toolRow("tool-1", { toolLifecycleStatus: "inProgress" })],
      hydrated,
      { unsettledTurnId: RUNNING_TURN },
    );
    expect(running.runningToolIds.has("tool-1")).toBe(true);
    expect(timelineLifecycleHasOneShots(running)).toBe(false);

    const completed = advance(
      [userRow("user-1"), toolRow("tool-1", { toolLifecycleStatus: "completed" })],
      running,
      { unsettledTurnId: RUNNING_TURN },
    );
    expect([...completed.completingToolIds]).toEqual(["tool-1"]);

    const expired = expireTimelineLifecycleOneShots(completed);
    const remounted = advance(
      [userRow("user-1"), toolRow("tool-1", { toolLifecycleStatus: "completed" })],
      expired,
      { unsettledTurnId: RUNNING_TURN, now: 9_000 },
    );
    expect(remounted.completingToolIds.size).toBe(0);
  });

  it("does not flash tool calls that were expanded into view already completed", () => {
    const hydrated = advance(
      [userRow("user-1"), toolRow("tool-9", { toolLifecycleStatus: "completed" })],
      EMPTY_TIMELINE_LIFECYCLE_LEDGER,
    );

    // Expanding a work group reveals older, already-finished tool calls.
    const expanded = advance(
      [
        userRow("user-1"),
        toolRow("tool-6", { toolLifecycleStatus: "completed" }),
        toolRow("tool-7", { toolLifecycleStatus: "completed" }),
        toolRow("tool-9", { toolLifecycleStatus: "completed" }),
      ],
      hydrated,
    );

    expect(timelineLifecycleHasOneShots(expanded)).toBe(false);
  });

  it("gives a failed tool no completion accent", () => {
    const hydrated = advance([userRow("user-1")], EMPTY_TIMELINE_LIFECYCLE_LEDGER);
    const running = advance(
      [userRow("user-1"), toolRow("tool-1", { toolLifecycleStatus: "inProgress" })],
      hydrated,
      { unsettledTurnId: RUNNING_TURN },
    );

    const failed = advance(
      [userRow("user-1"), toolRow("tool-1", { toolLifecycleStatus: "failed" })],
      running,
      { unsettledTurnId: RUNNING_TURN },
    );

    expect(failed.completingToolIds.size).toBe(0);
    expect(timelineLifecycleHasOneShots(failed)).toBe(false);
  });

  it("keeps empty one-shot sets identity-stable so streaming ticks do not churn context", () => {
    const hydrated = advance([userRow("user-1")], EMPTY_TIMELINE_LIFECYCLE_LEDGER);
    const tick = advance([userRow("user-1"), assistantRow("assistant-1", true)], hydrated);
    const nextTick = advance([userRow("user-1"), assistantRow("assistant-1", true)], tick, {
      now: 1_050,
    });

    expect(nextTick.arrivingUserMessageIds).toBe(tick.arrivingUserMessageIds);
    expect(nextTick.resolvingStreamMessageIds).toBe(tick.resolvingStreamMessageIds);
    expect(nextTick.completingToolIds).toBe(tick.completingToolIds);
  });
});

describe("resolveTimelineSettleFold", () => {
  const thread = "local/thread-1";

  // The fix for the "finished response jumps to the top" bug: the settle edge
  // must be reported so the just-finished turn can stay unfolded until the
  // next one starts.
  it("reports the turn that just settled", () => {
    const decision = resolveTimelineSettleFold(
      { threadKey: thread, unsettledTurnId: "turn-1" as never },
      { threadKey: thread, unsettledTurnId: null },
    );

    expect(decision.deferFoldForTurnId).toBe("turn-1");
    expect(decision.next).toEqual({ threadKey: thread, unsettledTurnId: null });
  });

  it("reports nothing while a turn is still running", () => {
    expect(
      resolveTimelineSettleFold(
        { threadKey: thread, unsettledTurnId: "turn-1" as never },
        { threadKey: thread, unsettledTurnId: "turn-1" as never },
      ).deferFoldForTurnId,
    ).toBeNull();
  });

  // Re-entrancy guard: the deferral issues a state update during render, so
  // the immediate re-render must resolve to a no-op or it would loop.
  it("is inert when re-resolved over its own result", () => {
    const settled = resolveTimelineSettleFold(
      { threadKey: thread, unsettledTurnId: "turn-1" as never },
      { threadKey: thread, unsettledTurnId: null },
    );
    const again = resolveTimelineSettleFold(settled.next, {
      threadKey: thread,
      unsettledTurnId: null,
    });

    expect(again.deferFoldForTurnId).toBeNull();
    expect(again.next).toBe(settled.next);
  });

  it("reports nothing when the next turn starts", () => {
    expect(
      resolveTimelineSettleFold(
        { threadKey: thread, unsettledTurnId: null },
        { threadKey: thread, unsettledTurnId: "turn-2" as never },
      ).deferFoldForTurnId,
    ).toBeNull();
  });

  // Switching threads is not this thread's settle edge — a freshly opened
  // thread folds its history normally.
  it("never defers across a thread switch", () => {
    const decision = resolveTimelineSettleFold(
      { threadKey: thread, unsettledTurnId: "turn-1" as never },
      { threadKey: "local/thread-2", unsettledTurnId: null },
    );

    expect(decision.deferFoldForTurnId).toBeNull();
    expect(decision.next).toEqual({ threadKey: "local/thread-2", unsettledTurnId: null });
  });
});
