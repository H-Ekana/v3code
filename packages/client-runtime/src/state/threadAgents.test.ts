import { describe, expect, it } from "@effect/vitest";
import type { OrchestrationThreadActivity, ThreadAgentSnapshot } from "@t3tools/contracts";
import {
  deriveAgentPanelState,
  deriveLatestAgentSnapshot,
  formatAgentDisplayName,
  formatAgentObjective,
  formatAgentTokenCount,
} from "./threadAgents.ts";

// Shape captured from a real server run (integrated verification, 2026-07-20).
const persistedAgent = {
  agentId: "a732c41b4b7ba7742",
  provider: "claudeAgent",
  kind: "subagent",
  name: "Say hi",
  agentType: "general-purpose",
  status: "completed",
  usage: { totalTokens: 22_798, toolUses: 0 },
  firstStartedAt: "2026-07-21T03:52:02.264Z",
  lastActivityAt: "2026-07-21T03:52:03.936Z",
  endedAt: "2026-07-21T03:52:03.936Z",
  activationCount: 1,
  lastTurnId: "45609775-4b3b-4444-879d-1d9f25a1b954",
  resultSummary: "Hi! How can I help you today?",
  recentActivity: [],
  updatedAt: "2026-07-21T03:52:03.936Z",
};

describe("agent identity presentation", () => {
  it("cleans only recognized generated display-name wrappers", () => {
    expect(formatAgentDisplayName("You are transcript_review")).toBe("transcript_review");
    expect(formatAgentDisplayName("Role: roster-review")).toBe("roster-review");
    expect(formatAgentDisplayName("Role: ---")).toBe("Role: ---");
    expect(formatAgentDisplayName("Accessibility review")).toBe("Accessibility review");
  });

  it("removes a leading role sentence only when it matches the structured name", () => {
    expect(
      formatAgentObjective(
        "transcript_review",
        "You are transcript-review. Perform a read-only consistency review.",
      ),
    ).toBe("Perform a read-only consistency review.");
    expect(
      formatAgentObjective("reader_review", "Role: contract_review. Inspect the contract."),
    ).toBe("Role: contract_review. Inspect the contract.");
    expect(formatAgentObjective("reader_review", "You are reviewing one focused file.")).toBe(
      "You are reviewing one focused file.",
    );
  });
});

function activity(
  kind: string,
  payload: unknown,
  sequence: number,
  createdAt = "2026-07-21T03:52:03.936Z",
): OrchestrationThreadActivity {
  return {
    id: `evt-${sequence}`,
    tone: "info",
    kind,
    summary: "agents",
    payload,
    turnId: null,
    sequence,
    createdAt,
  } as OrchestrationThreadActivity;
}

function staleWorkflowRoster(): ReadonlyArray<ThreadAgentSnapshot> {
  const workflow = {
    ...persistedAgent,
    agentId: "wf-1",
    kind: "workflow",
    name: "diagnostic workflow",
    status: "running",
    currentActivity: "Collecting workflow results",
    phases: [{ index: 0, title: "Diagnose" }],
  } as unknown as ThreadAgentSnapshot;
  const first = {
    ...persistedAgent,
    agentId: "wf-1:wf:0",
    kind: "workflow_agent",
    name: "First diagnostic",
    status: "running",
    parentAgentId: "wf-1",
    phaseIndex: 0,
    phaseTitle: "Diagnose",
    currentActivity: "Writing final report",
  } as unknown as ThreadAgentSnapshot;
  const second = {
    ...first,
    agentId: "wf-1:wf:1",
    name: "Second diagnostic",
  } as unknown as ThreadAgentSnapshot;
  return [workflow, first, second];
}

describe("deriveLatestAgentSnapshot", () => {
  it("decodes a persisted server payload and returns the newest roster", () => {
    const agents = deriveLatestAgentSnapshot([
      activity("agent.snapshot", { agents: [{ ...persistedAgent, status: "running" }] }, 1),
      activity("context-window.updated", { usedTokens: 10 }, 2),
      activity("agent.snapshot", { agents: [persistedAgent] }, 3),
    ]);
    expect(agents).toHaveLength(1);
    expect(agents[0]?.status).toBe("completed");
    expect(agents[0]?.usage?.totalTokens).toBe(22_798);
    expect(agents[0]?.resultSummary).toBe("Hi! How can I help you today?");
  });

  it("hydrates a returned workflow with every child terminal", () => {
    const agents = deriveLatestAgentSnapshot([
      activity(
        "task.completed",
        { taskId: "wf-1", status: "completed", summary: "Workflow returned" },
        10,
        "2026-07-21T04:00:00.000Z",
      ),
      // The contradictory frame was persisted after the return and still says
      // both children are running. Terminal evidence must outrank it.
      activity(
        "agent.snapshot",
        { agents: staleWorkflowRoster(), revision: 7 },
        11,
        "2026-07-21T04:00:01.000Z",
      ),
    ]);

    expect(agents.map((agent) => agent.status)).toEqual(["completed", "stopped", "stopped"]);
    expect(agents.every((agent) => agent.endedAt === "2026-07-21T04:00:00.000Z")).toBe(true);
    expect(agents.every((agent) => agent.currentActivity === undefined)).toBe(true);
  });

  it("does not revive stale running cards when every workflow child recorded a result", () => {
    const agents = deriveLatestAgentSnapshot([
      activity(
        "task.completed",
        { taskId: "wf-1:wf:0", status: "completed", summary: "First result" },
        20,
        "2026-07-21T04:01:00.000Z",
      ),
      activity(
        "task.completed",
        { taskId: "wf-1:wf:1", status: "failed", summary: "Second result" },
        21,
        "2026-07-21T04:01:01.000Z",
      ),
      activity(
        "agent.snapshot",
        { agents: staleWorkflowRoster(), revision: 8 },
        22,
        "2026-07-21T04:01:02.000Z",
      ),
    ]);

    expect(agents.map((agent) => agent.status)).toEqual(["completed", "completed", "failed"]);
    expect(agents.slice(1).map((agent) => agent.resultSummary)).toEqual([
      "First result",
      "Second result",
    ]);
    expect(agents.some((agent) => agent.status === "running")).toBe(false);
  });

  it("keeps a reactivated workflow child live when its recorded result belongs to an older run", () => {
    const roster = staleWorkflowRoster().map((agent) =>
      agent.agentId === "wf-1:wf:0"
        ? { ...agent, lastStartedAt: "2026-07-21T05:00:00.000Z" }
        : agent,
    );
    const agents = deriveLatestAgentSnapshot([
      activity(
        "task.completed",
        { taskId: "wf-1:wf:0", status: "completed", summary: "Earlier result" },
        25,
        "2026-07-21T04:01:00.000Z",
      ),
      activity("agent.snapshot", { agents: roster, revision: 9 }, 26, "2026-07-21T05:00:01.000Z"),
    ]);

    expect(agents.find((agent) => agent.agentId === "wf-1:wf:0")?.status).toBe("running");
  });

  it("keeps hydrated footer counts equal to the terminal workflow cards", () => {
    const agents = deriveLatestAgentSnapshot([
      activity(
        "task.completed",
        { taskId: "wf-1", status: "completed", summary: "Workflow returned" },
        30,
        "2026-07-21T04:02:00.000Z",
      ),
      activity(
        "agent.snapshot",
        { agents: staleWorkflowRoster(), revision: 9 },
        31,
        "2026-07-21T04:02:01.000Z",
      ),
    ]);
    const state = deriveAgentPanelState(agents);
    const cards = state.groups.flatMap((group) => [
      ...group.phases.flatMap((phase) => phase.agents),
      ...group.rest,
    ]);

    expect(cards).toHaveLength(2);
    expect(cards.every((card) => card.status === "stopped")).toBe(true);
    expect(state.runningCount).toBe(0);
    expect(state.waitingCount).toBe(0);
    expect(state.settledCount).toBe(cards.length);
  });

  it("treats the newest agents array as authoritative even when its rows fail to decode", () => {
    // Falling back to the older roster would resurrect a stale "running"
    // snapshot; an undecodable newest roster must yield an empty panel.
    const agents = deriveLatestAgentSnapshot([
      activity("agent.snapshot", { agents: [persistedAgent], revision: 1 }, 1),
      activity("agent.snapshot", { agents: [{ bogus: true }], revision: 2 }, 2),
    ]);
    expect(agents).toHaveLength(0);
  });

  it("skips bad rows within a roster while keeping decodable ones", () => {
    const agents = deriveLatestAgentSnapshot([
      activity("agent.snapshot", { agents: [persistedAgent, { bogus: true }], revision: 1 }, 1),
    ]);
    expect(agents).toHaveLength(1);
    expect(agents[0]?.agentId).toBe(persistedAgent.agentId);
  });

  it("selects the highest revision regardless of list position", () => {
    const older = { ...persistedAgent, status: "running" };
    const agents = deriveLatestAgentSnapshot([
      activity("agent.snapshot", { agents: [persistedAgent], revision: 5 }, 1),
      activity("agent.snapshot", { agents: [older], revision: 4 }, 2),
    ]);
    expect(agents[0]?.status).toBe("completed");
  });

  it("returns an empty roster when no snapshot activity exists", () => {
    expect(deriveLatestAgentSnapshot([activity("task.progress", {}, 1)])).toHaveLength(0);
  });
});

describe("deriveAgentPanelState", () => {
  const base = deriveLatestAgentSnapshot([
    activity("agent.snapshot", { agents: [persistedAgent] }, 1),
  ]);

  it("excludes thin-forwarder usage after a detached companion handoff", () => {
    const ordinary: ThreadAgentSnapshot = {
      ...(base[0] as ThreadAgentSnapshot),
      agentId: "ordinary",
    };
    const detached: ThreadAgentSnapshot = {
      ...(base[0] as ThreadAgentSnapshot),
      agentId: "rescue",
      provider: "claudeAgent" as ThreadAgentSnapshot["provider"],
      delegateProvider: "codex" as ThreadAgentSnapshot["provider"],
      agentType: "codex:codex-rescue",
      runId: "task-live-123",
    };

    const state = deriveAgentPanelState([ordinary, detached]);

    expect(state.totalTokens).toBe(ordinary.usage?.totalTokens);
  });

  it("counts settled agents and sums tokens", () => {
    const state = deriveAgentPanelState(base);
    expect(state.settledCount).toBe(1);
    expect(state.runningCount).toBe(0);
    expect(state.backgroundRunningCount).toBe(0);
    expect(state.totalTokens).toBe(22_798);
    expect(state.groups).toHaveLength(0);
    expect(state.subagents).toHaveLength(1);
    expect(state.subagents[0]?.agent.agentId).toBe(persistedAgent.agentId);
    expect(state.subagents[0]?.shells).toHaveLength(0);
    expect(state.backgroundTasks).toHaveLength(0);
  });

  it("partitions active and settled sub-agent statuses", () => {
    const statuses: ReadonlyArray<ThreadAgentSnapshot["status"]> = [
      "running",
      "completed",
      "pending",
      "failed",
      "waiting",
      "stopped",
      "idle",
    ];
    const state = deriveAgentPanelState(
      statuses.map(
        (status): ThreadAgentSnapshot => ({
          ...(base[0] as ThreadAgentSnapshot),
          agentId: status,
          status,
        }),
      ),
    );

    expect(state.activeSubagents.map((row) => row.agent.agentId)).toEqual([
      "running",
      "pending",
      "waiting",
    ]);
    expect(state.settledSubagents.map((row) => row.agent.agentId)).toEqual([
      "completed",
      "failed",
      "stopped",
      "idle",
    ]);
  });

  it("keeps the compatibility subagents list active-first", () => {
    const completed: ThreadAgentSnapshot = {
      ...(base[0] as ThreadAgentSnapshot),
      agentId: "completed",
    };
    const running: ThreadAgentSnapshot = {
      ...completed,
      agentId: "running",
      status: "running",
    };
    const failed: ThreadAgentSnapshot = {
      ...completed,
      agentId: "failed",
      status: "failed",
    };

    const state = deriveAgentPanelState([completed, running, failed]);

    expect(state.subagents.map((row) => row.agent.agentId)).toEqual([
      "running",
      "completed",
      "failed",
    ]);
    expect(state.subagents).toEqual([...state.activeSubagents, ...state.settledSubagents]);
  });

  it("sorts settled sub-agents by newest finish time", () => {
    const oldest: ThreadAgentSnapshot = {
      ...(base[0] as ThreadAgentSnapshot),
      agentId: "oldest",
      endedAt: "2026-07-21T03:00:00.000Z",
    };
    const newest: ThreadAgentSnapshot = {
      ...oldest,
      agentId: "newest",
      endedAt: "2026-07-21T05:00:00.000Z",
    };
    const middle: ThreadAgentSnapshot = {
      ...oldest,
      agentId: "middle",
      endedAt: "2026-07-21T04:00:00.000Z",
    };

    const state = deriveAgentPanelState([oldest, newest, middle]);

    expect(state.settledSubagents.map((row) => row.agent.agentId)).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
  });

  it("falls back to lastActivityAt and sinks unparseable finish times", () => {
    // An idle Codex row can settle without ever writing endedAt, and a
    // corrupted timestamp must not float to the top of the Finished group.
    const { endedAt: _endedAt, ...withoutEndedAt } = base[0] as ThreadAgentSnapshot;
    const fallback: ThreadAgentSnapshot = {
      ...withoutEndedAt,
      agentId: "fallback",
      status: "idle",
      lastActivityAt: "2026-07-21T06:00:00.000Z",
    };
    const ended: ThreadAgentSnapshot = {
      ...(base[0] as ThreadAgentSnapshot),
      agentId: "ended",
      endedAt: "2026-07-21T05:00:00.000Z",
    };
    const unparseable: ThreadAgentSnapshot = {
      ...(base[0] as ThreadAgentSnapshot),
      agentId: "unparseable",
      endedAt: "not-a-timestamp",
    };

    const state = deriveAgentPanelState([unparseable, ended, fallback]);

    expect(state.settledSubagents.map((row) => row.agent.agentId)).toEqual([
      "fallback",
      "ended",
      "unparseable",
    ]);
  });

  it("breaks settled ties on roster order", () => {
    const first: ThreadAgentSnapshot = {
      ...(base[0] as ThreadAgentSnapshot),
      agentId: "first",
      endedAt: "2026-07-21T05:00:00.000Z",
    };
    const second: ThreadAgentSnapshot = { ...first, agentId: "second" };
    const third: ThreadAgentSnapshot = { ...first, agentId: "third" };

    const state = deriveAgentPanelState([first, second, third]);

    expect(state.settledSubagents.map((row) => row.agent.agentId)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("nests a parented shell under its sub-agent row", () => {
    const subagent: ThreadAgentSnapshot = {
      ...(base[0] as ThreadAgentSnapshot),
      agentId: "subagent-1",
    };
    const shell: ThreadAgentSnapshot = {
      ...(base[0] as ThreadAgentSnapshot),
      agentId: "shell-1",
      kind: "shell",
      parentAgentId: "subagent-1",
      status: "running",
    };

    const state = deriveAgentPanelState([subagent, shell]);

    expect(state.subagents).toHaveLength(1);
    expect(state.subagents[0]?.agent.agentId).toBe("subagent-1");
    expect(state.subagents[0]?.shells.map((agent) => agent.agentId)).toEqual(["shell-1"]);
    expect(state.backgroundTasks).toHaveLength(0);
  });

  it("keeps a parented shell on a settled sub-agent row", () => {
    const subagent: ThreadAgentSnapshot = {
      ...(base[0] as ThreadAgentSnapshot),
      agentId: "settled-subagent",
      status: "completed",
    };
    const shell: ThreadAgentSnapshot = {
      ...(base[0] as ThreadAgentSnapshot),
      agentId: "settled-shell",
      kind: "shell",
      parentAgentId: "settled-subagent",
      status: "completed",
    };

    const state = deriveAgentPanelState([subagent, shell]);

    expect(state.settledSubagents).toHaveLength(1);
    expect(state.settledSubagents[0]?.shells.map((agent) => agent.agentId)).toEqual([
      "settled-shell",
    ]);
    expect(state.backgroundTasks).toHaveLength(0);
  });

  it("puts unparented and orphaned shells in background tasks", () => {
    const shell: ThreadAgentSnapshot = {
      ...(base[0] as ThreadAgentSnapshot),
      agentId: "shell-1",
      kind: "shell",
      parentAgentId: undefined,
      status: "running",
    };
    const orphanedShell: ThreadAgentSnapshot = {
      ...shell,
      agentId: "shell-2",
      parentAgentId: "missing-subagent",
    };

    const state = deriveAgentPanelState([shell, orphanedShell]);

    expect(state.subagents).toHaveLength(0);
    expect(state.backgroundTasks.map((agent) => agent.agentId)).toEqual(["shell-1", "shell-2"]);
  });

  it("excludes shells and monitors from the running agent count", () => {
    const subagent: ThreadAgentSnapshot = {
      ...(base[0] as ThreadAgentSnapshot),
      agentId: "subagent-1",
      status: "running",
    };
    const shell: ThreadAgentSnapshot = {
      ...(base[0] as ThreadAgentSnapshot),
      agentId: "shell-1",
      kind: "shell",
      parentAgentId: "subagent-1",
      status: "running",
    };
    const monitor: ThreadAgentSnapshot = {
      ...(base[0] as ThreadAgentSnapshot),
      agentId: "monitor-1",
      kind: "monitor",
      parentAgentId: undefined,
      status: "pending",
    };

    const state = deriveAgentPanelState([subagent, shell, monitor]);

    expect(state.runningCount).toBe(1);
    expect(state.backgroundRunningCount).toBe(2);
    expect(state.totalTokens).toBe(68_394);
  });

  it("groups workflow members under declared phases with derived status", () => {
    const workflow: ThreadAgentSnapshot = {
      ...(base[0] as ThreadAgentSnapshot),
      agentId: "wf-1",
      kind: "workflow",
      name: "audit",
      status: "running",
      phases: [
        { index: 0, title: "Audit" },
        { index: 1, title: "Verify" },
      ],
    };
    const member: ThreadAgentSnapshot = {
      ...(base[0] as ThreadAgentSnapshot),
      agentId: "wa-1",
      kind: "workflow_agent",
      parentAgentId: "wf-1",
      phaseIndex: 0,
      status: "completed",
    };
    const state = deriveAgentPanelState([workflow, member]);
    const group = state.groups[0];
    expect(group?.workflow?.agentId).toBe("wf-1");
    expect(group?.phases[0]?.status).toBe("done");
    expect(group?.phases[1]?.status).toBe("pending");
    expect(state.subagents).toHaveLength(0);
    expect(state.backgroundTasks).toHaveLength(0);
  });
});

describe("formatAgentTokenCount", () => {
  it("formats counts at k/M scale", () => {
    expect(formatAgentTokenCount(950)).toBe("950");
    expect(formatAgentTokenCount(22_798)).toBe("22.8k");
    expect(formatAgentTokenCount(1_200_000)).toBe("1.2M");
  });
});
