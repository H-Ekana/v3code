import { describe, expect, it } from "vite-plus/test";

import { mergeUsage, toUsageResult, windowStartDay } from "./usageStore.ts";

const EMPTY = { version: 1, since: null, entries: [] };

const record = (over: Partial<Parameters<typeof mergeUsage>[1]> = {}) => ({
  instanceId: "codex",
  model: "gpt-5.6-luna",
  operation: "generatePromptSuggestion" as const,
  succeeded: true,
  inputTokens: 7_086,
  cachedInputTokens: 9_984,
  outputTokens: 5,
  at: "2026-08-01T12:00:00.000Z",
  ...over,
});

describe("mergeUsage", () => {
  it("accumulates repeated calls into one row per day", () => {
    const once = mergeUsage(EMPTY, record());
    const twice = mergeUsage(once, record());

    expect(twice.entries).toHaveLength(1);
    expect(twice.entries[0]!.calls).toBe(2);
    expect(twice.entries[0]!.inputTokens).toBe(14_172);
  });

  it("keeps separate rows per operation, so ghost prompts stay distinguishable", () => {
    const suggestion = mergeUsage(EMPTY, record());
    const commit = mergeUsage(suggestion, record({ operation: "generateCommitMessage" }));

    expect(commit.entries).toHaveLength(2);
  });

  it("keeps separate rows per day, so history survives", () => {
    const day1 = mergeUsage(EMPTY, record({ at: "2026-07-31T12:00:00.000Z" }));
    const day2 = mergeUsage(day1, record({ at: "2026-08-01T12:00:00.000Z" }));

    expect(day2.entries).toHaveLength(2);
  });

  it("treats unreported tokens as unknown, never zero", () => {
    const merged = mergeUsage(
      EMPTY,
      record({ inputTokens: null, cachedInputTokens: null, outputTokens: null }),
    );
    expect(merged.entries[0]!.inputTokens).toBeNull();

    // A later reported value starts the running total from that value.
    const then = mergeUsage(merged, record({ inputTokens: 100 }));
    expect(then.entries[0]!.inputTokens).toBe(100);
  });
});

describe("windowStartDay", () => {
  const now = "2026-08-01T12:00:00.000Z";
  it("resolves each window", () => {
    expect(windowStartDay("today", now)).toBe("2026-08-01");
    expect(windowStartDay("yesterday", now)).toBe("2026-07-31");
    expect(windowStartDay("last7Days", now)).toBe("2026-07-26");
    expect(windowStartDay("last30Days", now)).toBe("2026-07-03");
    expect(windowStartDay("allTime", now)).toBeNull();
  });
});

describe("toUsageResult", () => {
  const now = "2026-08-01T12:00:00.000Z";
  const stored = [
    record({ at: "2026-08-01T09:00:00.000Z" }),
    record({ at: "2026-07-31T09:00:00.000Z" }),
    record({ at: "2026-06-01T09:00:00.000Z" }),
  ].reduce(mergeUsage, EMPTY);

  it("counts only today for the today window", () => {
    const result = toUsageResult(stored, "today", now);
    expect(result.entries[0]!.calls).toBe(1);
    expect(result.window).toBe("today");
  });

  it("counts only yesterday for the yesterday window", () => {
    const result = toUsageResult(stored, "yesterday", now);
    expect(result.entries[0]!.calls).toBe(1);
    expect(result.entries[0]!.lastUsedAt).toBe("2026-07-31T09:00:00.000Z");
  });

  it("collapses days within a window into one row", () => {
    const result = toUsageResult(stored, "last7Days", now);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.calls).toBe(2); // Aug 1 + Jul 31, not June
  });

  it("includes everything for allTime and reports the earliest day", () => {
    const result = toUsageResult(stored, "allTime", now);
    expect(result.entries[0]!.calls).toBe(3);
    expect(result.since).toBe("2026-06-01");
  });

  it("prices the aggregate with cached input at the cheaper rate", () => {
    const result = toUsageResult(stored, "today", now);
    // 7086 @ $1/M + 9984 @ $0.10/M + 5 @ $6/M
    expect(result.totalEstimatedCostUsd).toBeCloseTo(0.007086 + 0.0009984 + 0.00003, 8);
    expect(result.hasUnpricedUsage).toBe(false);
  });

  it("flags unpriced models instead of reporting them as free", () => {
    const withUnknown = mergeUsage(EMPTY, record({ model: "mystery-model" }));
    const result = toUsageResult(withUnknown, "allTime", now);
    expect(result.entries[0]!.estimatedCostUsd).toBeNull();
    expect(result.hasUnpricedUsage).toBe(true);
    expect(result.totalEstimatedCostUsd).toBeNull();
  });
});
