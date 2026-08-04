import type { AgentTranscriptItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveAgentTranscriptTimelineEntries } from "./agentTranscriptTimeline";
import { deriveMessagesTimelineRows } from "./MessagesTimeline.logic";

const at = (seconds: number) => `2026-08-01T00:00:${String(seconds).padStart(2, "0")}.000Z`;

describe("deriveAgentTranscriptTimelineEntries", () => {
  it("orders by ordinal rather than by arrival", () => {
    const items: ReadonlyArray<AgentTranscriptItem> = [
      { id: "c", kind: "message", role: "assistant", text: "Done", at: at(3), ordinal: 2_000 },
      { id: "a", kind: "message", role: "user", text: "Go", at: at(1), ordinal: 0 },
      {
        id: "b",
        kind: "work",
        category: "command",
        label: "Bash",
        status: "completed",
        at: at(2),
        ordinal: 1_000,
      },
    ];

    expect(deriveAgentTranscriptTimelineEntries(items).map((entry) => entry.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("orders blocks of one record that share a timestamp", () => {
    // The case a timestamp sort cannot decide: same `at`, different blocks.
    const items: ReadonlyArray<AgentTranscriptItem> = [
      { id: "u:1", kind: "message", role: "assistant", text: "Second", at: at(1), ordinal: 1 },
      {
        id: "u:0",
        kind: "work",
        category: "thinking",
        label: "Thinking",
        status: "completed",
        at: at(1),
        ordinal: 0,
      },
    ];

    expect(deriveAgentTranscriptTimelineEntries(items).map((entry) => entry.id)).toEqual([
      "u:0",
      "u:1",
    ]);
  });

  it("carries tool identity and lifecycle onto the work entry", () => {
    const [entry] = deriveAgentTranscriptTimelineEntries([
      {
        id: "tool",
        kind: "work",
        category: "command",
        label: "Bash",
        status: "failed",
        at: at(1),
        toolCallId: "toolu_1",
        toolName: "Bash",
        itemType: "command_execution",
        command: "pnpm test",
        detail: "Run tests",
        outcome: "2 failed",
      },
    ]);

    expect(entry?.kind === "work" ? entry.entry : undefined).toMatchObject({
      label: "Bash",
      tone: "error",
      toolLifecycleStatus: "failed",
      toolCallId: "toolu_1",
      toolTitle: "Bash",
      itemType: "command_execution",
      command: "pnpm test",
      // Invocation detail and result are both kept so an expanded card shows
      // what was asked and what came back.
      detail: "Run tests\n\n2 failed",
    });
  });

  it("renders thinking as a thinking-toned entry", () => {
    const [entry] = deriveAgentTranscriptTimelineEntries([
      {
        id: "think",
        kind: "work",
        category: "thinking",
        label: "Thinking",
        status: "completed",
        at: at(1),
        detail: "considering options",
      },
    ]);

    expect(entry?.kind === "work" ? entry.entry.tone : undefined).toBe("thinking");
  });

  it("falls back to array order when a provider omits timestamps", () => {
    const items: ReadonlyArray<AgentTranscriptItem> = [
      { id: "first", kind: "message", role: "user", text: "One" },
      { id: "second", kind: "message", role: "assistant", text: "Two" },
    ];

    expect(deriveAgentTranscriptTimelineEntries(items).map((entry) => entry.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("keeps thinking and in-flight tools that the live timeline would hide", () => {
    // Both are "settled neutral" to the live view — no success, no failure —
    // so without the opt-out the transcript renders neither.
    const items: ReadonlyArray<AgentTranscriptItem> = [
      {
        id: "think",
        kind: "work",
        category: "thinking",
        label: "Thinking",
        status: "completed",
        at: at(1),
        detail: "weighing options",
      },
      {
        id: "running",
        kind: "work",
        category: "command",
        label: "Bash",
        status: "running",
        at: at(2),
      },
    ];
    const timelineEntries = deriveAgentTranscriptTimelineEntries(items);
    const base = {
      timelineEntries,
      latestTurn: null,
      runningTurnId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    };

    const hidden = deriveMessagesTimelineRows(base);
    expect(hidden.filter((row) => row.kind === "work")).toEqual([]);

    // Kept, but consecutive work still collapses to the newest row plus a
    // toggle — the live conversation's grouping, deliberately unchanged.
    const kept = deriveMessagesTimelineRows({ ...base, keepNeutralWorkEntries: true });
    expect(
      kept.flatMap((row) => (row.kind === "work" ? row.groupedEntries.map((e) => e.id) : [])),
    ).toEqual(["running"]);
    expect(kept.find((row) => row.kind === "work-toggle")).toMatchObject({ hiddenCount: 1 });

    const expanded = deriveMessagesTimelineRows({
      ...base,
      keepNeutralWorkEntries: true,
      expandedWorkGroupIds: new Set(["work-group:think"]),
    });
    expect(
      expanded.flatMap((row) => (row.kind === "work" ? row.groupedEntries.map((e) => e.id) : [])),
    ).toEqual(["think", "running"]);
  });

  it("pins a failed tool call out of the group collapse", () => {
    const items: ReadonlyArray<AgentTranscriptItem> = [
      {
        id: "failed",
        kind: "work",
        category: "command",
        label: "Bash",
        status: "failed",
        at: at(1),
        outcome: "exit 128",
      },
      { id: "ok-1", kind: "work", category: "tool", label: "Read", status: "completed", at: at(2) },
      { id: "ok-2", kind: "work", category: "tool", label: "Grep", status: "completed", at: at(3) },
    ];
    const base = {
      timelineEntries: deriveAgentTranscriptTimelineEntries(items),
      latestTurn: null,
      runningTurnId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
      keepNeutralWorkEntries: true,
    };

    // Without pinning, only the newest row survives and the failure hides.
    expect(
      deriveMessagesTimelineRows(base).flatMap((row) =>
        row.kind === "work" ? row.groupedEntries.map((e) => e.id) : [],
      ),
    ).toEqual(["ok-2"]);

    const pinned = deriveMessagesTimelineRows({ ...base, pinFailedWorkEntries: true });
    expect(
      pinned.flatMap((row) => (row.kind === "work" ? row.groupedEntries.map((e) => e.id) : [])),
    ).toEqual(["failed", "ok-2"]);
    expect(pinned.find((row) => row.kind === "work-toggle")).toMatchObject({ hiddenCount: 1 });
  });

  it("omits the toggle when pinning leaves nothing hidden", () => {
    const items: ReadonlyArray<AgentTranscriptItem> = [
      { id: "f1", kind: "work", category: "command", label: "Bash", status: "failed", at: at(1) },
      { id: "f2", kind: "work", category: "command", label: "Bash", status: "failed", at: at(2) },
    ];
    const rows = deriveMessagesTimelineRows({
      timelineEntries: deriveAgentTranscriptTimelineEntries(items),
      latestTurn: null,
      runningTurnId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
      keepNeutralWorkEntries: true,
      pinFailedWorkEntries: true,
    });

    expect(rows.flatMap((row) => (row.kind === "work" ? [row.id] : []))).toEqual(["f1", "f2"]);
    expect(rows.some((row) => row.kind === "work-toggle")).toBe(false);
  });

  it("maps a system item to an assistant row rather than dropping it", () => {
    const [entry] = deriveAgentTranscriptTimelineEntries([
      { id: "sys", kind: "message", role: "system", text: "Context note", at: at(1) },
    ]);

    expect(entry?.kind === "message" ? entry.message.role : undefined).toBe("assistant");
  });
});
