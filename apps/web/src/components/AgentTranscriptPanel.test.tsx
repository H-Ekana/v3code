import type { ThreadAgentSnapshot } from "@t3tools/contracts";
import { formatAgentDisplayName } from "@t3tools/client-runtime/state/thread-agents";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import AgentTranscriptPanel, {
  compactTechnicalActivity,
  findFinalTranscriptMessage,
  formatAgentCompletionSummary,
  formatAgentHealth,
  formatAgentIdentityLine,
  formatTranscriptSummaryLabel,
  omitDuplicateObjective,
  summarizeAgentWork,
  summarizeCompletionEvidence,
} from "./AgentTranscriptPanel";

const agent = {
  agentId: "agent-a",
  provider: "codex",
  kind: "subagent",
  name: "agent-a",
  agentType: "worker",
  model: "gpt-5.6-sol",
  objective: "Implement and verify the transcript view.",
  reasoningEffort: "medium",
  status: "running",
  currentActivity: "Running focused tests",
  currentActivityKind: "verifying",
  currentActivityLifecycle: "started",
  usage: { totalTokens: 7300000, toolUses: 12 },
  firstStartedAt: "2026-08-01T12:00:00.000Z",
  lastActivityAt: "2026-08-01T12:01:00.000Z",
  activationCount: 1,
  plan: [
    { step: "Inspect the panel", status: "completed" },
    { step: "Run focused tests", status: "inProgress" },
  ],
  recentActivity: [
    {
      at: "2026-08-01T12:01:00.000Z",
      summary: "vp test run AgentTranscriptPanel.test.tsx",
      kind: "verifying",
      lifecycle: "started",
    },
  ],
  updatedAt: "2026-08-01T12:01:00.000Z",
} as unknown as ThreadAgentSnapshot;

describe("AgentTranscriptPanel", () => {
  it("cleans generated role prefixes from persisted display names", () => {
    expect(formatAgentDisplayName("You are transcript_review")).toBe("transcript_review");
    expect(formatAgentDisplayName("Role: roster_review")).toBe("roster_review");
    expect(formatAgentDisplayName("Accessibility review")).toBe("Accessibility review");
  });

  it("omits only a first user message that duplicates the objective", () => {
    const items = [
      { id: "prompt", kind: "message", role: "user", text: "Inspect this file.\nRead only." },
      { id: "reply", kind: "message", role: "assistant", text: "I will inspect it." },
    ] as const;

    expect(
      omitDuplicateObjective(items, "Inspect this file. Read only.").map((item) => item.id),
    ).toEqual(["reply"]);
    expect(omitDuplicateObjective(items, "Inspect another file.")).toBe(items);
  });

  it("finds the chronological final turn and formats completion metadata", () => {
    const items = [
      { id: "reply", kind: "message", role: "assistant", text: "Working." },
      { id: "final", kind: "message", role: "assistant", text: "Done.", phase: "final" },
    ] as const;
    const completed = {
      ...agent,
      status: "idle",
      endedAt: "2026-08-01T12:00:30.000Z",
      activationCount: 1,
    } as ThreadAgentSnapshot;

    expect(findFinalTranscriptMessage(items, completed.status, true)?.id).toBe("final");
    // A provider-declared final phase stands on its own; the heuristic tail
    // does not, because a partial page ends mid-work.
    expect(findFinalTranscriptMessage(items, completed.status, false)?.id).toBe("final");
    const withoutPhase = [
      { id: "reply", kind: "message", role: "assistant", text: "Working." },
    ] as const;
    expect(findFinalTranscriptMessage(withoutPhase, completed.status, true)?.id).toBe("reply");
    expect(findFinalTranscriptMessage(withoutPhase, completed.status, false)).toBeNull();
    expect(formatAgentCompletionSummary(completed)).toBe("Completed in 30s · 1 run");
    const html = renderToStaticMarkup(
      <AgentTranscriptPanel
        agent={{ ...completed, resultSummary: "Done." }}
        fallbackName="Agent A"
      />,
    );
    expect(html).toContain("Finished · resumable");
    expect(html).toContain("Completed in 30s · 1 run");
  });

  it("breaks work down by disjoint category without restating a total", () => {
    const items = [
      { id: "cmd", kind: "work", category: "command", label: "Bash", status: "failed" },
      {
        id: "edit-1",
        kind: "work",
        category: "files",
        label: "Edit",
        status: "completed",
        changedFiles: ["a.ts", "b.ts"],
      },
      {
        id: "edit-2",
        kind: "work",
        category: "files",
        label: "Edit",
        status: "completed",
        // Same file touched twice must not double-count.
        changedFiles: ["a.ts"],
      },
      { id: "read", kind: "work", category: "tool", label: "Read", status: "completed" },
      { id: "think", kind: "work", category: "thinking", label: "Thinking", status: "completed" },
      { id: "msg", kind: "message", role: "assistant", text: "Done." },
    ] as const;

    // Named categories only. The residual "tool" bucket is omitted because the
    // meta row already prints the authoritative total, and a chip for the
    // remainder read as a second, smaller tool-call count.
    expect(summarizeAgentWork(items)).toEqual([
      { label: "1 command", tone: "neutral" },
      { label: "2 file edits", tone: "neutral" },
      { label: "2 files changed", tone: "neutral" },
      { label: "1 failed", tone: "error" },
    ]);
    expect(summarizeAgentWork([])).toEqual([]);
    // An agent that only read files produces no chips rather than a chip that
    // competes with the total.
    expect(
      summarizeAgentWork([
        { id: "r", kind: "work", category: "tool", label: "Read", status: "completed" },
      ] as const),
    ).toEqual([]);
  });

  it("never pairs a delegate's name with its host's model", () => {
    const displayProvider = (provider: string) => (provider === "codex" ? "Codex" : "Claude");
    const delegated = {
      ...agent,
      provider: "claudeAgent",
      delegateProvider: "codex",
      model: "claude-sonnet-5",
    } as ThreadAgentSnapshot;

    // The model belongs to the wrapper, so "Codex · claude-sonnet-5" would be
    // the card contradicting itself.
    expect(formatAgentIdentityLine(delegated, displayProvider as never)).toBe(
      "Codex job · hosted by Claude",
    );
    expect(formatAgentIdentityLine(agent, displayProvider as never)).toBe(
      "Codex · gpt-5.6-sol · medium reasoning",
    );
  });

  it("describes the transcript by messages and tool calls", () => {
    const items = [
      { id: "msg", kind: "message", role: "assistant", text: "Working." },
      { id: "cmd", kind: "work", category: "command", label: "Bash", status: "completed" },
      { id: "read", kind: "work", category: "tool", label: "Read", status: "completed" },
      { id: "think", kind: "work", category: "thinking", label: "Thinking", status: "completed" },
    ] as const;

    expect(formatTranscriptSummaryLabel(items)).toBe("1 message · 2 tool calls");
    expect(formatTranscriptSummaryLabel([])).toBe("No visible activity");
  });

  it("renders objective, progress, execution metadata, and captured transcript", () => {
    const html = renderToStaticMarkup(
      <AgentTranscriptPanel agent={agent} fallbackName="Agent A" />,
    );

    expect(html).toContain("Implement and verify the transcript view.");
    expect(html).toContain("gpt-5.6-sol");
    expect(html).toContain("medium reasoning");
    expect(html).toContain("1/2 complete");
    expect(html).toContain("Technical activity");
    expect(html).toContain("<details");
  });

  it("shows only exact matching identity cleanup and factual health", () => {
    const html = renderToStaticMarkup(
      <AgentTranscriptPanel
        agent={{
          ...agent,
          name: "You are transcript_review",
          objective: "You are transcript-review. Inspect one file.",
        }}
        fallbackName="Agent A"
      />,
    );
    expect(html).toContain(">transcript_review<");
    expect(html).toContain("Inspect one file.");
    expect(html).not.toContain("You are transcript-review.");
    expect(formatAgentHealth(agent, Date.parse("2026-08-01T12:01:30.000Z"))).toBe("Active now");
    expect(formatAgentHealth(agent, Date.parse("2026-08-01T12:04:00.000Z"))).toBe(
      "No activity for 3m",
    );
  });

  it("summarizes only structured completion evidence", () => {
    expect(
      summarizeCompletionEvidence([
        {
          id: "files",
          kind: "work",
          category: "files",
          label: "Changed 2 files",
          status: "completed",
        },
        {
          id: "command",
          kind: "work",
          category: "command",
          label: "Ran a command",
          status: "failed",
        },
      ]),
    ).toEqual(["1 completed work step", "2 changed files", "1 failed step"]);
  });

  it("hides contentless reasoning and merges lifecycle pairs", () => {
    const activity = compactTechnicalActivity([
      {
        at: "2026-08-01T12:00:00.000Z",
        summary: "Reasoning",
        kind: "reasoning",
        lifecycle: "started",
      },
      { at: "2026-08-01T12:00:01.000Z", summary: "rg TODO", kind: "command", lifecycle: "started" },
      {
        at: "2026-08-01T12:00:02.000Z",
        summary: "rg TODO",
        kind: "command",
        lifecycle: "completed",
      },
    ] as ThreadAgentSnapshot["recentActivity"]);
    expect(activity).toHaveLength(1);
    expect(activity[0]?.lifecycle).toBe("completed");
  });

  it("removes reporting duplicates when conversation messages are available", () => {
    const activity = compactTechnicalActivity(
      [
        {
          at: "2026-08-01T12:00:00.000Z",
          summary: "Final response",
          kind: "reporting",
          lifecycle: "completed",
        },
        {
          at: "2026-08-01T12:00:01.000Z",
          summary: "rg TODO",
          kind: "command",
          lifecycle: "completed",
        },
      ] as ThreadAgentSnapshot["recentActivity"],
      true,
    );
    expect(activity.map((entry) => entry.kind)).toEqual(["command"]);
  });

  it("truthfully reports a stale transcript tab", () => {
    const html = renderToStaticMarkup(<AgentTranscriptPanel agent={null} fallbackName="Agent A" />);
    expect(html).toContain("Agent A");
    expect(html).toContain("no longer present");
  });

  it("omits technical activity when there are no reportable events", () => {
    const html = renderToStaticMarkup(
      <AgentTranscriptPanel agent={{ ...agent, recentActivity: [] }} fallbackName="Agent A" />,
    );

    expect(html).not.toContain("Technical activity");
    expect(html).not.toContain("0 events");
  });

  it("places a fallback final result before technical activity", () => {
    const html = renderToStaticMarkup(
      <AgentTranscriptPanel
        agent={{ ...agent, status: "completed", resultSummary: "The focused review is complete." }}
        fallbackName="Agent A"
      />,
    );
    expect(html).toContain("Final result");
    expect(html).toContain("Completed in 1m · 1 run");
    expect(html.indexOf("The focused review is complete.")).toBeLessThan(
      html.indexOf("Technical activity"),
    );
  });
});
