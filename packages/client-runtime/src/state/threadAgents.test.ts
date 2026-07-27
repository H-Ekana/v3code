import { describe, expect, it } from "@effect/vitest";
import type { OrchestrationThreadActivity, ThreadAgentSnapshot } from "@t3tools/contracts";
import {
  deriveAgentPanelState,
  deriveLatestAgentSnapshot,
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

function activity(kind: string, payload: unknown, sequence: number): OrchestrationThreadActivity {
  return {
    id: `evt-${sequence}`,
    tone: "info",
    kind,
    summary: "agents",
    payload,
    turnId: null,
    sequence,
    createdAt: "2026-07-21T03:52:03.936Z",
  } as OrchestrationThreadActivity;
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
