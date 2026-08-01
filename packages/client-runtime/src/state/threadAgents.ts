/**
 * Derivation helpers for the thread agent roster.
 *
 * The server ships the full per-thread roster latest-wins in the payload of
 * `agent.snapshot` activities (see `@t3tools/contracts` ThreadAgentsActivityPayload).
 * Mirrors the `context-window.updated` pattern: select the newest roster
 * (highest revision), decode tolerantly, skip rows that fail to decode.
 */
import {
  THREAD_AGENT_TERMINAL_STATUSES,
  THREAD_AGENTS_ACTIVITY_KIND,
  ThreadAgentSnapshot,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const decodeAgent = Schema.decodeUnknownOption(ThreadAgentSnapshot);

interface RosterCandidate {
  readonly payload: { readonly agents: ReadonlyArray<unknown> };
  readonly revision: number;
}

interface TerminalTaskEvidence {
  readonly taskId: string;
  readonly status: "completed" | "failed" | "stopped";
  readonly completedAt: string;
  readonly summary?: string;
}

function peekRoster(payload: unknown): RosterCandidate | undefined {
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as { agents?: unknown; revision?: unknown };
  if (!Array.isArray(record.agents)) {
    return undefined;
  }
  return {
    payload: record as RosterCandidate["payload"],
    // Missing revision ranks lowest (-1), mirroring server hydration: a
    // revision-less legacy roster never beats a revisioned one, and among
    // equals the later list position wins.
    revision:
      typeof record.revision === "number" && Number.isInteger(record.revision)
        ? record.revision
        : -1,
  };
}

function peekTerminalTaskEvidence(
  activity: OrchestrationThreadActivity,
): TerminalTaskEvidence | undefined {
  if (
    activity.kind !== "task.completed" ||
    activity.payload === null ||
    typeof activity.payload !== "object"
  ) {
    return undefined;
  }
  const payload = activity.payload as {
    taskId?: unknown;
    status?: unknown;
    summary?: unknown;
    detail?: unknown;
  };
  if (
    typeof payload.taskId !== "string" ||
    (payload.status !== "completed" && payload.status !== "failed" && payload.status !== "stopped")
  ) {
    return undefined;
  }
  const summary =
    typeof payload.summary === "string"
      ? payload.summary
      : typeof payload.detail === "string"
        ? payload.detail
        : undefined;
  return {
    taskId: payload.taskId,
    status: payload.status,
    completedAt: activity.createdAt,
    ...(summary ? { summary } : {}),
  };
}

function evidenceBelongsToCurrentActivation(
  agent: ThreadAgentSnapshot,
  evidence: TerminalTaskEvidence,
): boolean {
  const startedAt = Date.parse(agent.lastStartedAt ?? agent.firstStartedAt);
  const completedAt = Date.parse(evidence.completedAt);
  // A persisted completion with the same task id is authoritative when either
  // timestamp is legacy/unparseable. When both are valid, reject only evidence
  // from an earlier activation of a resumable task id.
  return Number.isNaN(startedAt) || Number.isNaN(completedAt) || completedAt >= startedAt;
}

function settleAgentFromEvidence(
  agent: ThreadAgentSnapshot,
  evidence: TerminalTaskEvidence,
): ThreadAgentSnapshot {
  const { currentActivity, ...rest } = agent;
  void currentActivity;
  return {
    ...rest,
    status: evidence.status,
    endedAt: evidence.completedAt,
    ...(evidence.summary ? { resultSummary: evidence.summary } : {}),
  };
}

function reconcileTerminalTaskEvidence(
  agents: ReadonlyArray<ThreadAgentSnapshot>,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<ThreadAgentSnapshot> {
  const terminalByTaskId = new Map<string, TerminalTaskEvidence>();
  for (const activity of activities) {
    const evidence = peekTerminalTaskEvidence(activity);
    if (evidence) {
      // Activity order is chronological in hydrated thread detail. A later
      // terminal result for a reused task id supersedes an earlier activation.
      terminalByTaskId.set(evidence.taskId, evidence);
    }
  }

  const nextById = new Map(agents.map((agent) => [String(agent.agentId), agent]));
  for (const agent of agents) {
    const evidence = terminalByTaskId.get(String(agent.agentId));
    if (evidence && evidenceBelongsToCurrentActivation(agent, evidence)) {
      nextById.set(String(agent.agentId), settleAgentFromEvidence(agent, evidence));
    }
  }

  const workflows = agents.filter((agent) => agent.kind === "workflow");
  for (const originalWorkflow of workflows) {
    const workflowId = String(originalWorkflow.agentId);
    const workflow = nextById.get(workflowId) ?? originalWorkflow;
    const originalChildren = agents.filter(
      (agent) =>
        agent.kind === "workflow_agent" && agent.parentAgentId === originalWorkflow.agentId,
    );
    const children = originalChildren.map((child) => nextById.get(String(child.agentId)) ?? child);
    const allChildrenTerminal =
      children.length > 0 &&
      children.every((child) => THREAD_AGENT_TERMINAL_STATUSES.has(child.status));
    const workflowAlreadySettled =
      workflow.status === "idle" || THREAD_AGENT_TERMINAL_STATUSES.has(workflow.status);
    if (!allChildrenTerminal && !workflowAlreadySettled) {
      continue;
    }

    const latestChildCompletionAt = children
      .filter((child) => THREAD_AGENT_TERMINAL_STATUSES.has(child.status))
      .map((child) => child.endedAt ?? child.lastActivityAt)
      .sort()
      .at(-1);
    const sourceEndedAt = workflow.endedAt ?? latestChildCompletionAt ?? workflow.lastActivityAt;

    if (allChildrenTerminal && !workflowAlreadySettled) {
      nextById.set(
        workflowId,
        settleAgentFromEvidence(workflow, {
          taskId: workflowId,
          status: "completed",
          completedAt: sourceEndedAt,
        }),
      );
    }

    for (const child of children) {
      if (child.status === "idle" || THREAD_AGENT_TERMINAL_STATUSES.has(child.status)) {
        continue;
      }
      // A returned/settled workflow has no live source left that can advance a
      // stale progress-frame child. Do not claim it succeeded without its own
      // result; settle it neutrally at the workflow's terminal boundary.
      nextById.set(
        String(child.agentId),
        settleAgentFromEvidence(child, {
          taskId: String(child.agentId),
          status: "stopped",
          completedAt: sourceEndedAt,
        }),
      );
    }
  }

  return agents.map((agent) => nextById.get(String(agent.agentId)) ?? agent);
}

export function deriveLatestAgentSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<ThreadAgentSnapshot> {
  // Two passes so only ONE roster is schema-decoded per recompute: rosters
  // can dominate the 500-row activity window in busy sessions, and this runs
  // inside a useMemo that re-fires on every activities change. Winner =
  // highest revision, later list position breaking ties.
  let best: RosterCandidate | undefined;
  for (const activity of activities) {
    if (activity.kind !== THREAD_AGENTS_ACTIVITY_KIND) {
      continue;
    }
    const candidate = peekRoster(activity.payload);
    if (candidate && (!best || candidate.revision >= best.revision)) {
      best = candidate;
    }
  }
  if (!best) {
    return [];
  }
  // The winning roster is authoritative: rows decode per-element (one bad row
  // is skipped, the rest kept), and a fully undecodable roster yields an
  // empty panel rather than resurrecting an older snapshot.
  const decoded: ThreadAgentSnapshot[] = [];
  for (const candidate of best.payload.agents) {
    const result = decodeAgent(candidate);
    if (result._tag === "Some") {
      decoded.push(result.value);
    }
  }
  // The roster is the latest progress frame, not an authority allowed to
  // contradict terminal results persisted beside it. Reconcile only after
  // decoding the winning roster so a stale non-terminal frame cannot revive a
  // returned workflow or a child whose current activation recorded a result.
  return reconcileTerminalTaskEvidence(decoded, activities);
}

export function isDetachedCompanionAgent(agent: ThreadAgentSnapshot): boolean {
  return (
    agent.agentType === "codex:codex-rescue" &&
    agent.delegateProvider !== undefined &&
    agent.delegateProvider !== agent.provider &&
    agent.runId !== undefined
  );
}

export function isTerminalAgentStatus(status: ThreadAgentSnapshot["status"]): boolean {
  return THREAD_AGENT_TERMINAL_STATUSES.has(status);
}

export interface AgentPanelGroup {
  /** The workflow snapshot this group belongs to, or null for direct spawns. */
  readonly workflow: ThreadAgentSnapshot | null;
  /** Phase sections in declared order; agents without a phase land in `rest`. */
  readonly phases: ReadonlyArray<AgentPanelPhase>;
  readonly rest: ReadonlyArray<ThreadAgentSnapshot>;
}

export interface AgentPanelPhase {
  readonly index: number;
  readonly title: string;
  readonly status: "pending" | "running" | "done";
  readonly agents: ReadonlyArray<ThreadAgentSnapshot>;
}

export interface AgentPanelRow {
  readonly agent: ThreadAgentSnapshot;
  readonly shells: ReadonlyArray<ThreadAgentSnapshot>;
}

export interface AgentPanelState {
  readonly groups: ReadonlyArray<AgentPanelGroup>;
  readonly activeSubagents: ReadonlyArray<AgentPanelRow>;
  readonly settledSubagents: ReadonlyArray<AgentPanelRow>;
  readonly subagents: ReadonlyArray<AgentPanelRow>;
  readonly backgroundTasks: ReadonlyArray<ThreadAgentSnapshot>;
  readonly runningCount: number;
  readonly backgroundRunningCount: number;
  readonly waitingCount: number;
  readonly settledCount: number;
  readonly totalTokens: number;
}

function isSettledAgentStatus(status: ThreadAgentSnapshot["status"]): boolean {
  // idle counts as settled for phase/summary purposes: the run finished even
  // though the agent identity could be resumed.
  return status === "idle" || isTerminalAgentStatus(status);
}

function phaseStatus(agents: ReadonlyArray<ThreadAgentSnapshot>): "pending" | "running" | "done" {
  if (agents.length === 0) return "pending";
  if (agents.every((agent) => isSettledAgentStatus(agent.status))) return "done";
  return "running";
}

function isBackgroundTask(agent: ThreadAgentSnapshot): boolean {
  return agent.kind === "shell" || agent.kind === "monitor";
}

export function deriveAgentPanelState(agents: ReadonlyArray<ThreadAgentSnapshot>): AgentPanelState {
  const workflows = agents.filter((agent) => agent.kind === "workflow");
  const workflowIds = new Set(workflows.map((workflow) => workflow.agentId));
  const byParent = new Map<string, ThreadAgentSnapshot[]>();
  const subagentSnapshots: ThreadAgentSnapshot[] = [];
  const shellCandidates: ThreadAgentSnapshot[] = [];
  for (const agent of agents) {
    if (agent.kind === "workflow") continue;
    if (isBackgroundTask(agent)) {
      shellCandidates.push(agent);
    } else if (agent.parentAgentId && workflowIds.has(agent.parentAgentId)) {
      const list = byParent.get(agent.parentAgentId) ?? [];
      list.push(agent);
      byParent.set(agent.parentAgentId, list);
    } else {
      // Non-background rows whose parent never materialized remain visible as
      // sub-agents; shells and monitors are handled separately below.
      subagentSnapshots.push(agent);
    }
  }

  const groups: AgentPanelGroup[] = [];
  for (const workflow of workflows) {
    const members = byParent.get(workflow.agentId) ?? [];
    byParent.delete(workflow.agentId);
    const declaredPhases = workflow.phases ?? [];
    const phases: AgentPanelPhase[] = declaredPhases.map((phase) => {
      const phaseAgents = members.filter((agent) => agent.phaseIndex === phase.index);
      return {
        index: phase.index,
        title: phase.title,
        status: phaseStatus(phaseAgents),
        agents: phaseAgents,
      };
    });
    const inDeclaredPhase = new Set(
      phases.flatMap((phase) => phase.agents.map((agent) => agent.agentId)),
    );
    groups.push({
      workflow,
      phases,
      rest: members.filter((agent) => !inDeclaredPhase.has(agent.agentId)),
    });
  }

  const attachedSubagents = subagentSnapshots.map((agent) => ({
    agent,
    shells: [] as ThreadAgentSnapshot[],
  }));
  const subagentById = new Map(attachedSubagents.map((row) => [row.agent.agentId, row]));
  const backgroundTasks: ThreadAgentSnapshot[] = [];
  for (const shell of shellCandidates) {
    const parent = shell.parentAgentId ? subagentById.get(shell.parentAgentId) : undefined;
    if (parent) {
      parent.shells.push(shell);
    } else {
      backgroundTasks.push(shell);
    }
  }

  // Keep working agents prominent while collecting finished work below them.
  const decoratedSubagents = attachedSubagents.map((row, rosterIndex) => ({
    row,
    rosterIndex,
  }));
  const activeSubagents = decoratedSubagents
    .filter(({ row }) => !isSettledAgentStatus(row.agent.status))
    .map(({ row }) => row);
  const settledSubagents = decoratedSubagents
    .filter(({ row }) => isSettledAgentStatus(row.agent.status))
    .map(({ row, rosterIndex }) => {
      const finishedAt = Date.parse(row.agent.endedAt ?? row.agent.lastActivityAt);
      return {
        row,
        rosterIndex,
        finishedAt: Number.isNaN(finishedAt) ? Number.NEGATIVE_INFINITY : finishedAt,
      };
    })
    .sort((left, right) => {
      if (left.finishedAt !== right.finishedAt) {
        return left.finishedAt < right.finishedAt ? 1 : -1;
      }
      return left.rosterIndex - right.rosterIndex;
    })
    .map(({ row }) => row);
  const subagents = [...activeSubagents, ...settledSubagents];

  // Workflow container rows are grouping chrome, not workers: they are
  // excluded from worker counts, and a container's own usage only counts when
  // it has no member rows to avoid double-counting the same tokens.
  const workflowsWithMembers = new Set(
    agents.flatMap((agent) =>
      agent.kind !== "workflow" && agent.parentAgentId ? [agent.parentAgentId] : [],
    ),
  );
  let runningCount = 0;
  let backgroundRunningCount = 0;
  let waitingCount = 0;
  let settledCount = 0;
  let totalTokens = 0;
  for (const agent of agents) {
    const isContainer = agent.kind === "workflow";
    if (!isContainer) {
      if (agent.status === "running" || agent.status === "pending") {
        if (isBackgroundTask(agent)) backgroundRunningCount += 1;
        else runningCount += 1;
      } else if (agent.status === "waiting") waitingCount += 1;
      else settledCount += 1; // idle + terminal
    }
    if (
      (!isContainer || !workflowsWithMembers.has(agent.agentId)) &&
      !isDetachedCompanionAgent(agent)
    ) {
      // The companion exposes no Codex usage. Once the row hands off, its
      // retained count belongs to the thin forwarder and must not be reported
      // as the detached job's token total.
      totalTokens += agent.usage?.totalTokens ?? 0;
    }
  }

  return {
    groups,
    activeSubagents,
    settledSubagents,
    subagents,
    backgroundTasks,
    runningCount,
    backgroundRunningCount,
    waitingCount,
    settledCount,
    totalTokens,
  };
}

export function formatAgentTokenCount(totalTokens: number): string {
  if (totalTokens >= 1_000_000) {
    return `${(totalTokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (totalTokens >= 1_000) {
    return `${(totalTokens / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${totalTokens}`;
}

const GENERATED_AGENT_ROLE = /^(?:Role:\s*|You are\s+(?:the\s+)?)([\w-]+)(?:\s+agent)?[.!:]?$/i;
const OBJECTIVE_ROLE_SENTENCE =
  /^(?:You are\s+(?:the\s+)?([\w-]+)(?:\s+agent)?|Role:\s*([\w-]+))\.\s*/i;

function normalizeAgentRole(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/-/g, "_");
}

function isMeaningfulAgentRole(value: string): boolean {
  return /[a-z0-9_]/i.test(value);
}

export function formatAgentDisplayName(name: string): string {
  const trimmed = name.trim();
  const generatedRole = trimmed.match(GENERATED_AGENT_ROLE)?.[1];
  return generatedRole && isMeaningfulAgentRole(generatedRole) ? generatedRole : trimmed;
}

export function formatAgentObjective(name: string, objective: string): string {
  const trimmed = objective.trim();
  const match = trimmed.match(OBJECTIVE_ROLE_SENTENCE);
  const declaredRole = match?.[1] ?? match?.[2];
  const displayName = formatAgentDisplayName(name);
  if (
    !match ||
    !declaredRole ||
    !isMeaningfulAgentRole(declaredRole) ||
    normalizeAgentRole(declaredRole) !== normalizeAgentRole(displayName)
  ) {
    return trimmed;
  }
  return trimmed.slice(match[0].length).trimStart();
}
