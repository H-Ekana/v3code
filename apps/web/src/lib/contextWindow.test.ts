import { describe, expect, it } from "vite-plus/test";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import {
  deriveLatestContextCompactionStatus,
  deriveLatestContextWindowSnapshot,
  deriveVisibleContextCompactionStatus,
  formatContextWindowTokens,
  providerSupportsManualContextCompaction,
} from "./contextWindow";

function makeActivity(id: string, kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt: "2026-03-23T00:00:00.000Z",
  };
}

describe("contextWindow", () => {
  it("derives the latest valid context window snapshot", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 1000,
      }),
      makeActivity("activity-2", "tool.started", {}),
      makeActivity("activity-3", "context-window.updated", {
        usedTokens: 14_000,
        maxTokens: 258_000,
        compactsAutomatically: true,
      }),
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(14_000);
    expect(snapshot?.totalProcessedTokens).toBeNull();
    expect(snapshot?.maxTokens).toBe(258_000);
    expect(snapshot?.compactsAutomatically).toBe(true);
  });

  it("ignores malformed payloads", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {}),
    ]);

    expect(snapshot).toBeNull();
  });

  it("keeps valid zero-usage snapshots", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 0,
        maxTokens: 100_000,
      }),
    ]);

    expect(snapshot).toMatchObject({
      usedTokens: 0,
      maxTokens: 100_000,
      remainingTokens: 100_000,
      usedPercentage: 0,
      remainingPercentage: 100,
    });
  });

  it("formats compact token counts", () => {
    expect(formatContextWindowTokens(999)).toBe("999");
    expect(formatContextWindowTokens(1400)).toBe("1.4k");
    expect(formatContextWindowTokens(14_000)).toBe("14k");
    expect(formatContextWindowTokens(258_000)).toBe("258k");
  });

  it("includes total processed tokens when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 81_659,
        totalProcessedTokens: 748_126,
        maxTokens: 258_400,
        lastUsedTokens: 81_659,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(81_659);
    expect(snapshot?.totalProcessedTokens).toBe(748_126);
  });

  it("derives the latest context compaction lifecycle state", () => {
    expect(
      deriveLatestContextCompactionStatus([
        makeActivity("activity-1", "context-compaction.started", {}),
      ]),
    ).toMatchObject({ state: "compacting" });
    expect(
      deriveLatestContextCompactionStatus([
        makeActivity("activity-1", "context-compaction.started", {}),
        makeActivity("activity-2", "context-compaction", {}),
      ]),
    ).toMatchObject({ state: "completed" });
    expect(
      deriveLatestContextCompactionStatus([
        makeActivity("activity-1", "context-compaction.started", {}),
        makeActivity("activity-2", "provider.context.compact.failed", {}),
      ]),
    ).toMatchObject({ state: "failed" });
  });

  it("keeps completion visible until the next user message", () => {
    const activities = [
      {
        ...makeActivity("activity-1", "context-compaction", {}),
        createdAt: "2026-03-23T00:00:10.000Z",
      },
    ];

    expect(
      deriveVisibleContextCompactionStatus(activities, [
        { role: "user", createdAt: "2026-03-23T00:00:09.000Z" },
        { role: "assistant", createdAt: "2026-03-23T00:00:11.000Z" },
      ]),
    ).toMatchObject({ state: "completed" });
    expect(
      deriveVisibleContextCompactionStatus(activities, [
        { role: "user", createdAt: "2026-03-23T00:00:11.000Z" },
      ]),
    ).toBeNull();
  });

  it("detects native and provider-advertised compaction support", () => {
    expect(providerSupportsManualContextCompaction({ driver: "codex", slashCommands: [] })).toBe(
      true,
    );
    expect(providerSupportsManualContextCompaction({ driver: "grok", slashCommands: [] })).toBe(
      true,
    );
    expect(
      providerSupportsManualContextCompaction({
        driver: "claudeAgent",
        slashCommands: [{ name: "compact" }],
      }),
    ).toBe(true);
    expect(
      providerSupportsManualContextCompaction({ driver: "claudeAgent", slashCommands: [] }),
    ).toBe(false);
  });
});
