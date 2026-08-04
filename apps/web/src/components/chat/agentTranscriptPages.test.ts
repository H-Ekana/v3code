import type { AgentTranscriptItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mergeAgentTranscriptPages } from "./agentTranscriptPages";

const call = (over: Partial<AgentTranscriptItem> & { id: string; ordinal: number }) =>
  ({
    kind: "work",
    category: "command",
    label: "Bash",
    status: "running",
    toolName: "Bash",
    ...over,
  }) as AgentTranscriptItem;

describe("mergeAgentTranscriptPages", () => {
  it("replaces an item restated by a refresh instead of keeping the stale copy", () => {
    // The settle refresh re-reads page 1; a tool that was running is now done.
    const merged = mergeAgentTranscriptPages(
      [call({ id: "a:0", ordinal: 0, status: "running" })],
      [call({ id: "a:0", ordinal: 0, status: "completed", outcome: "ok" })],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ status: "completed", outcome: "ok" });
  });

  it("folds a next-page result back into the call it belongs to", () => {
    const merged = mergeAgentTranscriptPages(
      [call({ id: "a:0", ordinal: 0, status: "running", toolCallId: "toolu_1" })],
      [
        {
          id: "b:0",
          kind: "work",
          category: "other",
          label: "Tool result",
          status: "failed",
          ordinal: 1_000,
          toolCallId: "toolu_1",
          outcome: "exit 1",
        } as AgentTranscriptItem,
      ],
    );

    // One card that reads correctly, not a spinner beside a detached result.
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "a:0",
      toolName: "Bash",
      status: "failed",
      outcome: "exit 1",
    });
  });

  it("keeps a result whose call is nowhere to be found", () => {
    const orphan = {
      id: "b:0",
      kind: "work",
      category: "other",
      label: "Tool result",
      status: "completed",
      ordinal: 5,
      toolCallId: "toolu_missing",
    } as AgentTranscriptItem;

    expect(mergeAgentTranscriptPages([], [orphan])).toEqual([orphan]);
  });

  it("orders the merged record by ordinal, not by arrival", () => {
    // "Load more" appends an earlier page after a later one.
    const merged = mergeAgentTranscriptPages(
      [call({ id: "late", ordinal: 5_000 })],
      [call({ id: "early", ordinal: 1_000 })],
    );

    expect(merged.map((item) => item.id)).toEqual(["early", "late"]);
  });

  it("does not treat a second call sharing a page as a result", () => {
    const merged = mergeAgentTranscriptPages(
      [call({ id: "a:0", ordinal: 0, toolCallId: "toolu_1" })],
      [call({ id: "b:0", ordinal: 1_000, toolCallId: "toolu_2" })],
    );

    expect(merged.map((item) => item.id)).toEqual(["a:0", "b:0"]);
  });
});
