import type { AgentTranscriptItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveAgentTranscriptTimelineEntries } from "./agentTranscriptTimeline";

const at = (seconds: number) => `2026-08-01T00:00:${String(seconds).padStart(2, "0")}.000Z`;

describe("deriveAgentTranscriptTimelineEntries", () => {
  it("interleaves messages and work by timestamp rather than array order", () => {
    const items: ReadonlyArray<AgentTranscriptItem> = [
      { id: "c", kind: "message", role: "assistant", text: "Done", at: at(3) },
      { id: "a", kind: "message", role: "user", text: "Go", at: at(1) },
      {
        id: "b",
        kind: "work",
        category: "command",
        label: "Bash",
        status: "completed",
        at: at(2),
      },
    ];

    expect(deriveAgentTranscriptTimelineEntries(items).map((entry) => entry.id)).toEqual([
      "a",
      "b",
      "c",
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

  it("maps a system item to an assistant row rather than dropping it", () => {
    const [entry] = deriveAgentTranscriptTimelineEntries([
      { id: "sys", kind: "message", role: "system", text: "Context note", at: at(1) },
    ]);

    expect(entry?.kind === "message" ? entry.message.role : undefined).toBe("assistant");
  });
});
