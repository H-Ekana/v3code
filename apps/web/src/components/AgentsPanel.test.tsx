import { ProviderDriverKind, type ThreadAgentSnapshot } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import AgentsPanel, { computeAgentLifecycleAccents } from "./AgentsPanel";

const TIMESTAMP = "2026-07-27T10:00:00.000Z";

function agent(
  overrides: Partial<ThreadAgentSnapshot> & Pick<ThreadAgentSnapshot, "agentId" | "provider">,
): ThreadAgentSnapshot {
  return {
    kind: "subagent",
    name: "Test agent",
    status: "running",
    firstStartedAt: TIMESTAMP,
    lastActivityAt: TIMESTAMP,
    activationCount: 1,
    recentActivity: [],
    updatedAt: TIMESTAMP,
    ...overrides,
  } as ThreadAgentSnapshot;
}

function renderAgent(snapshot: ThreadAgentSnapshot): string {
  return renderToStaticMarkup(<AgentsPanel agents={[snapshot]} mode="embedded" />);
}

describe("AgentsPanel provider identity", () => {
  it("renders the Claude provider icon", () => {
    const markup = renderAgent(
      agent({
        agentId: "claude-agent",
        provider: ProviderDriverKind.make("claudeAgent"),
      }),
    );

    expect(markup).toContain('data-agent-provider="claudeAgent"');
    expect(markup).toContain('aria-label="Claude"');
    expect(markup).toContain('viewBox="0 0 256 257"');
    expect(markup).toContain("fill-[#d97757]");
  });

  it("renders the OpenAI icon for a Codex provider", () => {
    const markup = renderAgent(
      agent({
        agentId: "codex-agent",
        provider: ProviderDriverKind.make("codex"),
      }),
    );

    expect(markup).toContain('data-agent-provider="codex"');
    expect(markup).toContain('aria-label="Codex"');
    expect(markup).toContain('viewBox="0 0 256 260"');
    expect(markup).toContain("fill-black dark:fill-white");
  });

  it("uses the delegated Codex provider as primary and retains the Claude host mark", () => {
    const markup = renderAgent(
      agent({
        agentId: "delegated-agent",
        provider: ProviderDriverKind.make("claudeAgent"),
        delegateProvider: ProviderDriverKind.make("codex"),
      }),
    );

    expect(markup).toContain('data-agent-provider="codex"');
    expect(markup).toContain('data-host-provider="claudeAgent"');
    expect(markup).toContain('data-host-provider-mark="claudeAgent"');
    expect(markup).toContain('aria-label="Codex, run by Claude"');
    expect(markup).toContain('viewBox="0 0 256 260"');
    expect(markup).toContain('viewBox="0 0 256 257"');
  });

  it("falls back to provider initials for an unknown provider slug", () => {
    const markup = renderAgent(
      agent({
        agentId: "unknown-agent",
        provider: ProviderDriverKind.make("mystery-provider"),
      }),
    );

    expect(markup).toContain('data-agent-provider="mystery-provider"');
    expect(markup).toContain(">MP</span>");
  });

  it("preserves the accessible status label beside the provider icon", () => {
    const markup = renderAgent(
      agent({
        agentId: "waiting-agent",
        provider: ProviderDriverKind.make("claudeAgent"),
        status: "waiting",
      }),
    );

    expect(markup).toContain('class="sr-only">Waiting</span>');
  });
});

describe("AgentsPanel sections", () => {
  it("shows completed sub-agents under an expanded Finished toggle by default", () => {
    const markup = renderAgent(
      agent({
        agentId: "completed-agent",
        provider: ProviderDriverKind.make("codex"),
        name: "Completed agent",
        status: "completed",
      }),
    );
    const finishedToggle = markup.match(
      /<button[^>]*aria-label="Finished sub-agents · 1"[^>]*>.*?<\/button>/,
    )?.[0];

    expect(finishedToggle).toBeDefined();
    // Open on first paint: the roster is usually opened to read what a
    // finished sub-agent did, so its results must not start hidden.
    expect(finishedToggle).toContain('aria-expanded="true"');
    expect(finishedToggle).toContain("Finished");
    expect(finishedToggle).toContain("· 1");
    expect(markup).toContain("Completed agent");
  });

  it("shows running sub-agents alongside completed siblings", () => {
    const running = agent({
      agentId: "running-agent",
      provider: ProviderDriverKind.make("codex"),
      name: "Running sibling",
    });
    const completed = agent({
      agentId: "completed-agent",
      provider: ProviderDriverKind.make("codex"),
      name: "Completed sibling",
      status: "completed",
    });
    const markup = renderToStaticMarkup(
      <AgentsPanel agents={[completed, running]} mode="embedded" />,
    );

    expect(markup).toContain("Running sibling");
    expect(markup).toContain("Completed sibling");
    expect(markup).toContain('aria-label="Finished sub-agents · 1"');
  });

  it("omits the Finished toggle when no sub-agents are settled", () => {
    const markup = renderAgent(
      agent({
        agentId: "running-agent",
        provider: ProviderDriverKind.make("codex"),
        name: "Running agent",
      }),
    );

    expect(markup).toContain("Running agent");
    expect(markup).not.toContain('aria-label="Finished sub-agents"');
  });

  it("keeps background tasks collapsed and countable", () => {
    const markup = renderAgent(
      agent({
        agentId: "shell-1",
        provider: ProviderDriverKind.make("claudeAgent"),
        kind: "shell",
        name: "Background shell",
      }),
    );

    expect(markup).toContain('aria-label="Background tasks"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Background tasks");
    expect(markup).toContain("· 1");
    expect(markup).not.toContain("Background shell");
  });

  it("shows parented shell counts on the sub-agent instead of a top-level shell card", () => {
    const parent = agent({
      agentId: "parent-agent",
      provider: ProviderDriverKind.make("codex"),
      name: "Parent agent",
    });
    const shell = agent({
      agentId: "shell-1",
      provider: ProviderDriverKind.make("codex"),
      kind: "shell",
      parentAgentId: "parent-agent",
      name: "Nested shell",
    });
    const markup = renderToStaticMarkup(<AgentsPanel agents={[parent, shell]} mode="embedded" />);

    expect(markup).toContain('aria-label="Sub-agents"');
    expect(markup).toContain("· 1 shell");
    expect(markup).not.toContain("Nested shell");
  });
});

describe("AgentCard work kind", () => {
  it("labels a live card with the companion job phase alongside its activity", () => {
    const markup = renderAgent(
      agent({
        agentId: "rescue-1",
        provider: ProviderDriverKind.make("claudeAgent"),
        delegateProvider: ProviderDriverKind.make("codex"),
        name: "Trace card title churn",
        status: "running",
        phaseTitle: "verifying",
        currentActivity: "Running focused reducer tests",
      }),
    );

    expect(markup).toContain("verifying");
    expect(markup).toContain("Running focused reducer tests");
  });

  it("renders the phase alone when a live card has no activity line yet", () => {
    const markup = renderAgent(
      agent({
        agentId: "rescue-2",
        provider: ProviderDriverKind.make("claudeAgent"),
        name: "Freshly launched rescue",
        status: "running",
        phaseTitle: "investigating",
      }),
    );

    expect(markup).toContain("investigating");
  });

  // The settled case (a completed card must drop its last phase) is deliberately
  // uncovered: settled sub-agents render inside the collapsed `Finished` group,
  // which `renderToStaticMarkup` never expands, so the card emits no markup at
  // all. An assertion here would pass against an empty string rather than
  // against the behavior.

  it("does not repeat the phase on a workflow child that already sits under a phase header", () => {
    const markup = renderAgent(
      agent({
        agentId: "wf-child",
        provider: ProviderDriverKind.make("claudeAgent"),
        kind: "workflow_agent",
        name: "Reviewer",
        status: "running",
        phaseIndex: 0,
        phaseTitle: "Inspect",
        currentActivity: "Reading the diff",
      }),
    );

    expect(markup).toContain("Reading the diff");
    expect(markup).not.toContain("Inspect");
  });
});

describe("agent lifecycle accents", () => {
  const roster = (
    entries: ReadonlyArray<[string, ThreadAgentSnapshot["status"]]>,
  ): ReadonlyArray<Pick<ThreadAgentSnapshot, "agentId" | "status">> =>
    entries.map(([agentId, status]) => ({
      agentId,
      status,
    })) as ReadonlyArray<Pick<ThreadAgentSnapshot, "agentId" | "status">>;

  // Replay prevention, part 1: the panel unmounts whenever the sheet closes.
  // The first observation of a roster is a remount or a first paint, never a
  // change, so nothing may animate — otherwise reopening the panel replays
  // every arrival and completion the thread has ever had.
  it("animates nothing on the first observation of a roster", () => {
    const { accents } = computeAgentLifecycleAccents({
      previousStatusById: null,
      agents: roster([
        ["running-agent", "running"],
        ["finished-agent", "completed"],
        ["failed-agent", "failed"],
      ]),
    });

    expect(accents.size).toBe(0);
  });

  // Replay prevention, part 2: a historical agent that was ALREADY terminal
  // when first seen never completes in front of the user, so it gets no
  // completion accent on any later render either.
  it("never completes an agent that was already settled when first seen", () => {
    const first = computeAgentLifecycleAccents({
      previousStatusById: null,
      agents: roster([["finished-agent", "completed"]]),
    });
    const second = computeAgentLifecycleAccents({
      previousStatusById: first.statusById,
      agents: roster([["finished-agent", "completed"]]),
    });

    expect(second.accents.size).toBe(0);
  });

  it("gives a genuinely new agent one arrival", () => {
    const first = computeAgentLifecycleAccents({
      previousStatusById: null,
      agents: roster([["existing", "running"]]),
    });
    const second = computeAgentLifecycleAccents({
      previousStatusById: first.statusById,
      agents: roster([
        ["existing", "running"],
        ["fresh", "pending"],
      ]),
    });

    expect(second.accents.get("fresh")).toBe("arrival");
    expect(second.accents.has("existing")).toBe(false);
  });

  it("gives an observed run-to-finish transition one completion", () => {
    const first = computeAgentLifecycleAccents({
      previousStatusById: null,
      agents: roster([["worker", "running"]]),
    });
    const second = computeAgentLifecycleAccents({
      previousStatusById: first.statusById,
      agents: roster([["worker", "completed"]]),
    });

    expect(second.accents.get("worker")).toBe("completion");
  });

  it("does not re-fire the completion on subsequent renders of the settled agent", () => {
    const first = computeAgentLifecycleAccents({
      previousStatusById: null,
      agents: roster([["worker", "running"]]),
    });
    const second = computeAgentLifecycleAccents({
      previousStatusById: first.statusById,
      agents: roster([["worker", "completed"]]),
    });
    const third = computeAgentLifecycleAccents({
      previousStatusById: second.statusById,
      agents: roster([["worker", "completed"]]),
    });

    expect(third.accents.size).toBe(0);
  });

  // An agent whose first sighting is already terminal (a very fast subagent)
  // is new, not finished: one accent, not two stacked on the same transition.
  it("spends only the arrival on an agent that appears already settled", () => {
    const first = computeAgentLifecycleAccents({
      previousStatusById: null,
      agents: roster([["existing", "running"]]),
    });
    const second = computeAgentLifecycleAccents({
      previousStatusById: first.statusById,
      agents: roster([
        ["existing", "running"],
        ["instant", "completed"],
      ]),
    });

    expect(second.accents.get("instant")).toBe("arrival");
  });

  it("survives a reorder without manufacturing an accent", () => {
    const first = computeAgentLifecycleAccents({
      previousStatusById: null,
      agents: roster([
        ["a", "running"],
        ["b", "running"],
      ]),
    });
    const second = computeAgentLifecycleAccents({
      previousStatusById: first.statusById,
      agents: roster([
        ["b", "running"],
        ["a", "running"],
      ]),
    });

    expect(second.accents.size).toBe(0);
  });

  it("does not treat a non-terminal status change as a completion", () => {
    const first = computeAgentLifecycleAccents({
      previousStatusById: null,
      agents: roster([["worker", "pending"]]),
    });
    const second = computeAgentLifecycleAccents({
      previousStatusById: first.statusById,
      agents: roster([["worker", "running"]]),
    });

    expect(second.accents.size).toBe(0);
  });
});
