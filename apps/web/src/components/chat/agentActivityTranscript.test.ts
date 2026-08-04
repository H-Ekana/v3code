import type { AgentTranscriptItem, ThreadAgentSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveAgentActivityTranscriptItems,
  mergeCodexActivityWork,
  shouldPreferActivityFeed,
} from "./agentActivityTranscript";

type Entry = ThreadAgentSnapshot["recentActivity"][number];

const entry = (over: Partial<Entry> & Pick<Entry, "at" | "summary">): Entry => over as Entry;

describe("deriveAgentActivityTranscriptItems", () => {
  it("maps activity kinds onto transcript categories", () => {
    const items = deriveAgentActivityTranscriptItems([
      entry({ at: "2026-08-01T00:00:01.000Z", summary: "Running tests", kind: "command" }),
      entry({ at: "2026-08-01T00:00:02.000Z", summary: "Considering", kind: "reasoning" }),
      entry({ at: "2026-08-01T00:00:03.000Z", summary: "Patched a.ts", kind: "editing" }),
    ]);

    expect(items).toMatchObject([
      { kind: "work", category: "command", label: "Ran a command", detail: "Running tests" },
      { kind: "work", category: "thinking", label: "Thinking", detail: "Considering" },
      { kind: "work", category: "files", label: "Editing files", detail: "Patched a.ts" },
    ]);
  });

  it("renders a reporting entry as agent speech rather than a step", () => {
    const [item] = deriveAgentActivityTranscriptItems([
      entry({
        at: "2026-08-01T00:00:01.000Z",
        summary: "Here is what I found.",
        kind: "reporting",
      }),
    ]);

    expect(item).toMatchObject({
      kind: "message",
      role: "assistant",
      text: "Here is what I found.",
    });
  });

  it("carries failure and in-flight state through", () => {
    const items = deriveAgentActivityTranscriptItems([
      entry({
        at: "2026-08-01T00:00:01.000Z",
        summary: "boom (exit 1)",
        kind: "command",
        outcome: "error",
      }),
      entry({
        at: "2026-08-01T00:00:02.000Z",
        summary: "working",
        kind: "command",
        lifecycle: "started",
      }),
    ]);

    expect(items.map((item) => (item.kind === "work" ? item.status : null))).toEqual([
      "failed",
      "running",
    ]);
  });

  it("gives every entry a distinct id even when timestamps collide", () => {
    const items = deriveAgentActivityTranscriptItems([
      entry({ at: "2026-08-01T00:00:01.000Z", summary: "one" }),
      entry({ at: "2026-08-01T00:00:01.000Z", summary: "two" }),
    ]);

    expect(new Set(items.map((item) => item.id)).size).toBe(2);
  });
});

describe("mergeCodexActivityWork", () => {
  const message = (id: string, at: string, ordinal: number) =>
    ({ id, kind: "message", role: "assistant", text: id, at, ordinal }) as AgentTranscriptItem;

  it("interleaves shell and reasoning steps by timestamp and renumbers", () => {
    const merged = mergeCodexActivityWork(
      [
        message("first", "2026-08-01T00:00:00.000Z", 0),
        message("last", "2026-08-01T00:00:10.000Z", 1000),
      ],
      deriveAgentActivityTranscriptItems([
        entry({ at: "2026-08-01T00:00:05.000Z", summary: "rg TODO", kind: "command" }),
        entry({ at: "2026-08-01T00:00:20.000Z", summary: "Considering", kind: "reasoning" }),
      ]),
    );

    expect(merged.map((item) => (item.kind === "message" ? item.id : item.detail))).toEqual([
      "first",
      "rg TODO",
      "last",
      "Considering",
    ]);
    // Both downstream sorts compare `ordinal` only when both sides have one, so
    // an unnumbered recovered row would be placed by sort stability alone.
    expect(merged.map((item) => item.ordinal)).toEqual([0, 1, 2, 3]);
  });

  it("leaves categories the Codex transcript already carries in the feed", () => {
    // These arrive as rollout `event_msg`s, so merging them would double every
    // file change and web search against the richer transcript copy.
    const merged = mergeCodexActivityWork(
      [message("only", "2026-08-01T00:00:00.000Z", 0)],
      deriveAgentActivityTranscriptItems([
        entry({ at: "2026-08-01T00:00:01.000Z", summary: "Patched a.ts", kind: "editing" }),
        entry({ at: "2026-08-01T00:00:02.000Z", summary: "Searched docs", kind: "investigating" }),
        entry({ at: "2026-08-01T00:00:03.000Z", summary: "Here it is", kind: "reporting" }),
      ]),
    );

    expect(merged.map((item) => item.id)).toEqual(["only"]);
  });

  it("returns the transcript untouched when nothing is recoverable", () => {
    const items = [message("only", "2026-08-01T00:00:00.000Z", 0)];
    expect(mergeCodexActivityWork(items, [])).toBe(items);
  });

  it("does not let an undated transcript item strand every later step", () => {
    // A record with no `createdAt` must inherit the last dated position rather
    // than acting as a barrier that flushes the whole feed behind it.
    const merged = mergeCodexActivityWork(
      [
        message("first", "2026-08-01T00:00:00.000Z", 0),
        {
          id: "undated",
          kind: "message",
          role: "assistant",
          text: "undated",
        } as AgentTranscriptItem,
        message("third", "2026-08-01T00:00:10.000Z", 2000),
      ],
      deriveAgentActivityTranscriptItems([
        entry({ at: "2026-08-01T00:00:05.000Z", summary: "rg TODO", kind: "command" }),
      ]),
    );

    expect(merged.map((item) => (item.kind === "message" ? item.id : item.detail))).toEqual([
      "first",
      "undated",
      "rg TODO",
      "third",
    ]);
  });
});

describe("shouldPreferActivityFeed", () => {
  it("prefers the feed for a delegated agent, whose transcript is only a wrapper", () => {
    expect(
      shouldPreferActivityFeed({
        isDelegated: true,
        transcriptState: "available",
        activityWorkCount: 24,
      }),
    ).toBe(true);
  });

  it("keeps an ordinary sub-agent on its transcript no matter how big the feed grows", () => {
    // The regression this guards: the transcript is fetched once while the
    // feed grows live, so any count comparison eventually flips an ordinary
    // agent onto one-line summaries — and tells it it was delegated.
    expect(
      shouldPreferActivityFeed({
        isDelegated: false,
        transcriptState: "available",
        activityWorkCount: 500,
      }),
    ).toBe(false);
  });

  it("waits for a pending transcript rather than flashing the feed", () => {
    expect(
      shouldPreferActivityFeed({
        isDelegated: false,
        transcriptState: "pending",
        activityWorkCount: 4,
      }),
    ).toBe(false);
  });

  it("falls back to the feed when the provider exposes no transcript", () => {
    expect(
      shouldPreferActivityFeed({
        isDelegated: false,
        transcriptState: "unavailable",
        activityWorkCount: 4,
      }),
    ).toBe(true);
  });

  it("does not prefer an empty feed", () => {
    expect(
      shouldPreferActivityFeed({
        isDelegated: true,
        transcriptState: "unavailable",
        activityWorkCount: 0,
      }),
    ).toBe(false);
  });
});
