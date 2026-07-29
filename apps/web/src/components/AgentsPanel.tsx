import { createContext, memo, useContext, useEffect, useRef, useState } from "react";
import {
  THREAD_AGENT_COLLAPSED_ACTIVITY_COUNT,
  type ThreadAgentSnapshot,
} from "@t3tools/contracts";
import {
  deriveAgentPanelState,
  formatAgentTokenCount,
  isDetachedCompanionAgent,
  isTerminalAgentStatus,
  type AgentPanelGroup,
  type AgentPanelPhase,
  type AgentPanelRow,
} from "@t3tools/client-runtime/state/thread-agents";
import { BotIcon, BracesIcon, CheckIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { formatDuration } from "../session-logic";
import { formatTimestamp, parseTimestampDate } from "../timestampFormat";
import { useClientSettings } from "../hooks/useSettings";
import { formatProviderDisplayName } from "../lib/contextWindow";
import { getStatusPresentation, type StatusAxes } from "../lib/statusPresentation";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";

interface AgentsPanelProps {
  agents: ReadonlyArray<ThreadAgentSnapshot>;
  onOpenScript?: (scriptPath: string) => void;
  mode?: "sheet" | "sidebar" | "embedded";
}

/**
 * Agent lifecycle expressed on the four shared axes. The panel keeps its own
 * domain labels below ("Idle · resumable" says more here than the shared
 * "Ready to resume"), but colour and motion come from `statusPresentation` so
 * an agent card and a thread row cannot disagree about what running looks like.
 */
const STATUS_AXES: Record<ThreadAgentSnapshot["status"], StatusAxes> = {
  pending: { activity: "queued", attention: "none", outcome: "neutral", persistence: "active" },
  running: { activity: "running", attention: "none", outcome: "neutral", persistence: "active" },
  waiting: {
    activity: "waiting",
    attention: "approval-required",
    outcome: "neutral",
    persistence: "active",
  },
  idle: {
    activity: "complete",
    attention: "none",
    outcome: "neutral",
    persistence: "idle-resumable",
  },
  completed: {
    activity: "complete",
    attention: "none",
    outcome: "success",
    persistence: "active",
  },
  failed: { activity: "failed", attention: "none", outcome: "failure", persistence: "active" },
  stopped: {
    activity: "interrupted",
    attention: "none",
    outcome: "neutral",
    persistence: "active",
  },
};

const STATUS_ROLE_DOT_CLASS = {
  primary: "bg-primary",
  warning: "bg-warning",
  success: "bg-success",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground/50",
} as const;

function agentDotClass(status: ThreadAgentSnapshot["status"]): string {
  return STATUS_ROLE_DOT_CLASS[getStatusPresentation(STATUS_AXES[status]).colorRole];
}

const STATUS_LABEL: Record<ThreadAgentSnapshot["status"], string> = {
  pending: "Queued",
  running: "Running",
  waiting: "Waiting",
  idle: "Idle · resumable",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

export type AgentExecutionMode = "launching-job" | "detached-job";

/**
 * A codex-rescue row changes authority without changing identity: first it is
 * the short-lived Claude forwarder, then `runId` identifies the detached Codex
 * companion job whose watcher owns the card. Make that handoff visible instead
 * of asking users to infer it from the provider corner mark or elapsed timer.
 */
export function resolveAgentExecutionMode(agent: ThreadAgentSnapshot): AgentExecutionMode | null {
  if (isDetachedCompanionAgent(agent)) return "detached-job";
  const isCodexRescue =
    agent.agentType === "codex:codex-rescue" &&
    agent.delegateProvider !== undefined &&
    agent.delegateProvider !== agent.provider;
  if (!isCodexRescue) return null;
  return agent.status === "pending" || agent.status === "running" || agent.status === "waiting"
    ? "launching-job"
    : null;
}

const AGENT_EXECUTION_MODE_LABEL: Record<AgentExecutionMode, string> = {
  "launching-job": "Launching job",
  "detached-job": "Detached job",
};

const EMPTY_AGENT_SNAPSHOTS: ReadonlyArray<ThreadAgentSnapshot> = [];

// ── Lifecycle one-shots (plan item 4) ────────────────────────────────
//
// Arrival and completion are derived from an OBSERVED TRANSITION between two
// renders of the roster, never from the agent's current status. The panel
// unmounts every time the sheet closes; a status-derived accent would replay
// the whole roster's arrivals and completions on each reopen, and again on
// every reorder into and out of the `Finished` group.
//
// The first observation of a roster seeds silently — a remount, restored
// history, or a first paint is not a change — which is the same rule
// `confirmedLabelCrossfade` uses for branch labels.

export type AgentLifecycleAccent = "arrival" | "completion";

/** Long enough to cover the 180ms arrival and the 200ms completion so an
    unrelated re-render mid-flight cannot strip the class and cut it short. */
export const AGENT_ACCENT_HOLD_MS = 260;

interface AgentAccentEntry {
  readonly accent: AgentLifecycleAccent;
  readonly atMs: number;
}

export function computeAgentLifecycleAccents(input: {
  /** `null` on the very first observation: seed only, animate nothing. */
  previousStatusById: ReadonlyMap<string, ThreadAgentSnapshot["status"]> | null;
  agents: ReadonlyArray<Pick<ThreadAgentSnapshot, "agentId" | "status">>;
}): {
  accents: ReadonlyMap<string, AgentLifecycleAccent>;
  statusById: ReadonlyMap<string, ThreadAgentSnapshot["status"]>;
} {
  const statusById = new Map<string, ThreadAgentSnapshot["status"]>();
  const accents = new Map<string, AgentLifecycleAccent>();

  for (const agent of input.agents) {
    const agentId = String(agent.agentId);
    statusById.set(agentId, agent.status);
    if (input.previousStatusById === null) continue;

    const previousStatus = input.previousStatusById.get(agentId);
    if (previousStatus === undefined) {
      // Genuinely new to a roster we were already watching. One accent only —
      // an agent that appears already finished arrives, it does not also
      // "complete", because the user never saw it run.
      accents.set(agentId, "arrival");
      continue;
    }
    if (
      previousStatus !== agent.status &&
      isTerminalAgentStatus(agent.status) &&
      !isTerminalAgentStatus(previousStatus)
    ) {
      accents.set(agentId, "completion");
    }
  }

  return { accents, statusById };
}

const AgentAccentContext = createContext<ReadonlyMap<string, AgentLifecycleAccent>>(new Map());

function useAgentAccent(agentId: string): AgentLifecycleAccent | null {
  return useContext(AgentAccentContext).get(agentId) ?? null;
}

function useAgentLifecycleAccents(
  agents: ReadonlyArray<ThreadAgentSnapshot>,
): ReadonlyMap<string, AgentLifecycleAccent> {
  const statusByIdRef = useRef<ReadonlyMap<string, ThreadAgentSnapshot["status"]> | null>(null);
  const heldRef = useRef<ReadonlyMap<string, AgentAccentEntry>>(new Map());
  const exposedRef = useRef<ReadonlyMap<string, AgentLifecycleAccent>>(new Map());
  // Guarded on roster identity so React's double-invoked renders re-use the
  // previous answer instead of comparing the roster against itself and
  // silently swallowing the accent.
  const lastAgentsRef = useRef<ReadonlyArray<ThreadAgentSnapshot> | null>(null);

  if (lastAgentsRef.current !== agents) {
    lastAgentsRef.current = agents;
    const { accents, statusById } = computeAgentLifecycleAccents({
      previousStatusById: statusByIdRef.current,
      agents,
    });
    statusByIdRef.current = statusById;

    const now = Date.now();
    const held = new Map<string, AgentAccentEntry>();
    for (const [agentId, entry] of heldRef.current) {
      if (now - entry.atMs < AGENT_ACCENT_HOLD_MS && statusById.has(agentId)) {
        held.set(agentId, entry);
      }
    }
    for (const [agentId, accent] of accents) {
      held.set(agentId, { accent, atMs: now });
    }
    heldRef.current = held;
    exposedRef.current = new Map(
      [...held].map(([agentId, entry]) => [agentId, entry.accent] as const),
    );
  }

  return exposedRef.current;
}

/**
 * Remount key for a value that should crossfade on change but not on first
 * paint. Returns `null` until a real change is observed.
 */
function useChangeCrossfadeKey(value: string): string | null {
  const previousRef = useRef(value);
  const generationRef = useRef(0);
  if (previousRef.current !== value) {
    previousRef.current = value;
    generationRef.current += 1;
  }
  return generationRef.current === 0 ? null : `change-${generationRef.current}`;
}

function AgentStatusDot({ status }: { status: ThreadAgentSnapshot["status"] }) {
  return (
    <span
      className={cn("size-1.75 shrink-0 rounded-full", agentDotClass(status))}
      role="img"
      aria-label={STATUS_LABEL[status]}
    />
  );
}

function AgentProviderIcon({ agent }: { agent: ThreadAgentSnapshot }) {
  const provider = agent.delegateProvider ?? agent.provider;
  const isDelegated =
    agent.delegateProvider !== undefined && agent.delegateProvider !== agent.provider;
  const providerLabel = formatProviderDisplayName(provider);
  const hostProviderLabel = formatProviderDisplayName(agent.provider);
  const accessibleLabel = isDelegated
    ? `${providerLabel}, run by ${hostProviderLabel}`
    : providerLabel;

  return (
    <>
      <span
        // `agent-status-mark` owns the running ring: 3px beyond the mark, tight
        // and duty-cycled, replacing the dot's own continuous pulse so a
        // running agent shows one indicator rather than two.
        className="agent-status-mark relative size-5 shrink-0"
        data-agent-running={agent.status === "running" ? "true" : undefined}
        role="img"
        aria-label={accessibleLabel}
        title={accessibleLabel}
        data-agent-provider={provider}
        data-host-provider={isDelegated ? agent.provider : undefined}
      >
        <ProviderInstanceIcon
          driverKind={provider}
          displayName={String(provider)}
          className="size-5"
          iconClassName="size-5"
          statusDotClassName={agentDotClass(agent.status)}
          indicatorBackground="var(--card)"
        />
        {isDelegated ? (
          <span
            className="absolute -right-0.5 -bottom-0.5 z-20 inline-flex size-2.5 items-center justify-center rounded-sm border border-primary/20 bg-card p-px shadow-sm"
            aria-hidden
            data-host-provider-mark={agent.provider}
          >
            <ProviderInstanceIcon
              driverKind={agent.provider}
              displayName={String(agent.provider)}
              className="size-2"
              iconClassName="size-2"
            />
          </span>
        ) : null}
      </span>
      <span className="sr-only">{STATUS_LABEL[agent.status]}</span>
    </>
  );
}

/**
 * Self-ticking elapsed label (WorkingTimer pattern): writes its own text node
 * so per-second updates never cause React commits. Frozen once `endedAt` is
 * set or the agent settles.
 */
export function resolveAgentElapsedTiming(
  agent: ThreadAgentSnapshot,
  nowMs = Date.now(),
): {
  readonly initialText: string | null;
  readonly shouldTick: boolean;
  readonly startMs: number | null;
} {
  const settled = isTerminalAgentStatus(agent.status) || agent.status === "idle";
  // Current-activation start (falls back to firstStartedAt for pre-field
  // snapshots) so a resumed agent's timer excludes prior runs and idle gaps.
  const startMs =
    parseTimestampDate(agent.lastStartedAt ?? agent.firstStartedAt)?.getTime() ?? null;
  const endMs =
    (agent.endedAt ? parseTimestampDate(agent.endedAt)?.getTime() : null) ??
    (settled ? (parseTimestampDate(agent.lastActivityAt)?.getTime() ?? null) : null);
  // An end marker is authoritative even if its timestamp is malformed. In
  // that case omit the duration instead of silently turning it into a live
  // wall-clock timer. Settled rows likewise never tick.
  const shouldTick = !settled && agent.endedAt === undefined;
  const initialText =
    startMs === null || (!shouldTick && endMs === null)
      ? null
      : formatDuration(Math.max(0, (endMs ?? nowMs) - startMs));
  return { initialText, shouldTick, startMs };
}

function AgentElapsed({ agent }: { agent: ThreadAgentSnapshot }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const { initialText, shouldTick, startMs } = resolveAgentElapsedTiming(agent);

  useEffect(() => {
    if (startMs === null || !shouldTick) return;
    const update = () => {
      if (textRef.current) {
        textRef.current.textContent = formatDuration(Math.max(0, Date.now() - startMs));
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [shouldTick, startMs]);

  if (initialText === null) {
    return null;
  }
  return (
    <span ref={textRef} className="font-mono text-[11px] tabular-nums text-muted-foreground">
      {initialText}
    </span>
  );
}

function AgentCard({
  agent,
  shells = EMPTY_AGENT_SNAPSHOTS,
  showProviderIcon = true,
}: {
  agent: ThreadAgentSnapshot;
  shells?: ReadonlyArray<ThreadAgentSnapshot>;
  showProviderIcon?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const settings = useClientSettings();
  const accent = useAgentAccent(String(agent.agentId));
  const settled = isTerminalAgentStatus(agent.status);
  // Settled cards lead with outcome (error first); live cards with activity.
  const activity =
    agent.status === "waiting"
      ? "Waiting on approval or input"
      : settled || agent.status === "idle"
        ? (agent.errorMessage ??
          agent.resultSummary ??
          agent.currentActivity ??
          (agent.lastToolName ? `▸ ${agent.lastToolName}` : null))
        : (agent.currentActivity ??
          (agent.lastToolName ? `▸ ${agent.lastToolName}` : null) ??
          agent.resultSummary ??
          agent.errorMessage);
  const hasFeed = agent.recentActivity.length > 0;
  const hasDetails = hasFeed || shells.length > 0;
  const isLive = agent.status === "running" || agent.status === "waiting";
  const executionMode = resolveAgentExecutionMode(agent);
  // The Codex companion writes its live job phase (investigating | editing |
  // running | verifying | reviewing | finalizing) into `phaseTitle` on every
  // watcher tick, and nothing ever rendered it — the richest work-kind signal
  // we already collect was being discarded. Workflow children carry
  // `phaseTitle` too, but they sit under a `PhaseHeader` that already states
  // it, so `phaseIndex` (set only on workflow children) gates the duplicate.
  // Settled cards drop it: a finished agent's last phase is noise next to its
  // outcome.
  const workKind = isLive && agent.phaseIndex === undefined ? agent.phaseTitle : undefined;
  // Newest first, matching how the card reads top-down.
  const orderedActivity = agent.recentActivity.toReversed();
  const activityCount = orderedActivity.length;
  const visibleActivity = showAllActivity
    ? orderedActivity
    : orderedActivity.slice(0, THREAD_AGENT_COLLAPSED_ACTIVITY_COUNT);
  const hiddenActivityCount = activityCount - visibleActivity.length;

  return (
    // A div wrapping a header button, rather than one big button: the expanded
    // feed owns its own "show all" control, and a button cannot legally nest
    // inside another button.
    <div
      className={cn(
        // `agent-card` carries the 240ms settle of border/tint into the
        // inactive surface. That transition is the card body's ONLY move
        // during a completion — the ring→check on the status mark is the
        // single coordinated accent.
        "agent-card group/agent w-full rounded-lg border border-border/60 bg-card px-3 py-2 text-left",
        accent === "arrival" && "agent-card-arrival",
        hasDetails && "hover:border-primary/25",
        isLive && "border-primary/20 bg-primary/[0.035] shadow-[0_0_8px_-4px_var(--primary)]",
        agent.status === "waiting" && "border-warning/25",
        settled && "opacity-80",
      )}
    >
      <button
        type="button"
        onClick={() => hasDetails && setExpanded((value) => !value)}
        aria-expanded={hasDetails ? expanded : undefined}
        className={cn(
          "w-full rounded-sm text-left outline-hidden focus-visible:ring-1 focus-visible:ring-primary/60",
          hasDetails ? "cursor-pointer" : "cursor-default",
        )}
      >
        <div className="flex items-center gap-2">
          {showProviderIcon ? (
            <AgentProviderIcon agent={agent} />
          ) : (
            <AgentStatusDot status={agent.status} />
          )}
          <span className="min-w-0 truncate text-[12.5px] font-semibold">{agent.name}</span>
          {agent.agentType ? (
            <Badge variant="secondary" size="sm" className="min-w-0 max-w-28 shrink truncate">
              {agent.agentType}
            </Badge>
          ) : null}
          {executionMode ? (
            <Badge
              variant="outline"
              size="sm"
              className="shrink-0 text-muted-foreground"
              data-agent-execution-mode={executionMode}
            >
              {AGENT_EXECUTION_MODE_LABEL[executionMode]}
            </Badge>
          ) : null}
          {agent.model ? (
            <Badge variant="outline" size="sm" className="shrink-0 text-muted-foreground">
              {agent.model}
            </Badge>
          ) : null}
          <span className="ml-auto shrink-0">
            <AgentElapsed agent={agent} />
          </span>
          {agent.status === "completed" ? (
            // The running ring contracts into this check. One element, one
            // move: no card glow, icon flash, or border sweep beside it.
            <span
              className={cn(
                "inline-flex size-3 shrink-0 items-center justify-center rounded-full text-success",
                accent === "completion" && "agent-completion-mark",
              )}
            >
              <CheckIcon className="size-3" />
            </span>
          ) : null}
        </div>
        {activity || workKind ? (
          <div
            className={cn(
              "mt-1 truncate text-[11.5px]",
              agent.status === "failed" ? "text-destructive-foreground" : "text-muted-foreground",
            )}
          >
            {workKind ? (
              <span className="font-semibold tracking-wide text-primary/85 uppercase">
                {workKind}
              </span>
            ) : null}
            {workKind && activity ? <span className="text-border"> · </span> : null}
            {activity}
          </div>
        ) : null}
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          {executionMode === "detached-job" ? (
            <span title="The companion does not expose Codex token usage">Usage unavailable</span>
          ) : agent.usage ? (
            <span className="font-mono tabular-nums text-foreground">
              {formatAgentTokenCount(agent.usage.totalTokens)}{" "}
              <span className="text-muted-foreground">tok</span>
              {agent.status === "running" ? <span className="text-sky-500"> ↑</span> : null}
            </span>
          ) : null}
          {executionMode !== "detached-job" && agent.usage?.toolUses ? (
            <>
              <span className="text-border">·</span>
              <span>{agent.usage.toolUses} tools</span>
            </>
          ) : null}
          {agent.activationCount > 1 ? (
            <>
              <span className="text-border">·</span>
              <span>run {agent.activationCount}</span>
            </>
          ) : null}
          {shells.length > 0 ? (
            <span className="rounded-sm bg-muted/50 px-1.5 py-0.5 text-muted-foreground/80">
              · {shells.length} shell{shells.length === 1 ? "" : "s"}
            </span>
          ) : null}
          {hasDetails ? (
            <span className="ml-auto text-muted-foreground/70">
              <ChevronRightIcon
                className={cn(
                  "size-3 transition-[color,transform] duration-200 ease-out group-hover/agent:text-primary motion-reduce:transition-none",
                  expanded && "rotate-90",
                )}
              />
            </span>
          ) : null}
        </div>
      </button>
      {expanded && hasDetails ? (
        // Disclosure reveal: the detail feed eases in over 170ms rather than
        // mounting abruptly. Keyed to the disclosure, not to the activity text,
        // so a running agent's per-tick updates never re-trigger it.
        <div className="agent-activity-reveal mt-2 space-y-0.5 border-t border-primary/15 pt-2">
          {visibleActivity.map((entry) => (
            <div key={`${entry.at}-${entry.summary}`} className="flex gap-2 text-[11px]">
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground/60">
                {/* Slicing the ISO string rendered UTC, so every row sat hours
                    off the user's wall clock. Share the app-wide formatter so
                    these read like every other timestamp in the UI. */}
                {formatTimestamp(entry.at, settings.timestampFormat)}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1",
                  // Full text once expanded — truncating the history defeats
                  // the point of asking to see all of it.
                  showAllActivity ? "break-words" : "truncate",
                  entry.outcome === "error"
                    ? "text-destructive-foreground"
                    : "text-muted-foreground",
                )}
              >
                {entry.summary}
              </span>
            </div>
          ))}
          {shells.map((shell) => (
            <div key={shell.agentId} className="flex min-w-0 items-center gap-2 py-0.5 text-[11px]">
              <AgentStatusDot status={shell.status} />
              <span className="min-w-0 truncate text-muted-foreground">{shell.name}</span>
              {(shell.currentActivity ?? shell.lastToolName) ? (
                <span className="ml-auto max-w-1/2 truncate text-muted-foreground/60">
                  {shell.currentActivity ?? `▸ ${shell.lastToolName}`}
                </span>
              ) : null}
            </div>
          ))}
          {hiddenActivityCount > 0 || showAllActivity ? (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowAllActivity((value) => !value)}
                className="rounded-sm px-1 py-0.5 text-[11px] text-muted-foreground/70 outline-hidden transition-colors duration-200 hover:text-primary focus-visible:ring-1 focus-visible:ring-primary/60 motion-reduce:transition-none"
              >
                {showAllActivity ? "Show less" : `Show all ${activityCount}`}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PhaseHeader({ phase }: { phase: AgentPanelPhase }) {
  // "active" (not just status==="running"): a phase whose agents are all
  // pending/waiting is still in progress and must not read "0 running".
  const doneCount = phase.agents.filter(
    (agent) => agent.status === "idle" || isTerminalAgentStatus(agent.status),
  ).length;
  const activeCount = phase.agents.length - doneCount;
  // Level 1: counts crossfade instead of jumping. `null` on first paint, so a
  // phase header that merely remounts does not flash.
  const countKey = useChangeCrossfadeKey(`${activeCount}:${doneCount}`);
  return (
    <div className="flex items-center gap-2 px-1 pt-2 pb-1 text-[10px] text-muted-foreground">
      <span
        className={cn(
          "font-bold tracking-wider uppercase",
          phase.status === "done" && "text-success-foreground",
          phase.status === "running" && "text-primary",
          phase.status === "pending" && "opacity-50",
        )}
      >
        {phase.status === "done" ? "✓ " : ""}
        {phase.title}
      </span>
      {phase.status === "running" ? (
        <span
          key={countKey ?? "initial"}
          className={countKey === null ? undefined : "agent-phase-count"}
        >
          {activeCount} active{doneCount > 0 ? ` · ${doneCount} done` : ""}
        </span>
      ) : phase.status === "pending" ? (
        <span>pending</span>
      ) : null}
      <span className="h-px flex-1 bg-primary/15" />
    </div>
  );
}

function AgentGroup({
  group,
  onOpenScript,
}: {
  group: AgentPanelGroup;
  onOpenScript?: ((scriptPath: string) => void) | undefined;
}) {
  const scriptPath = group.workflow?.scriptPath;
  return (
    <div>
      <div className="flex items-center gap-2 px-1 pb-1 text-[10.5px] font-bold tracking-wider text-muted-foreground uppercase">
        {group.workflow ? (
          <>
            <span className="truncate">Workflow · {group.workflow.name}</span>
            {scriptPath && onOpenScript ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenScript(scriptPath);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.stopPropagation();
                    onOpenScript(scriptPath);
                  }
                }}
                className="inline-flex cursor-pointer items-center gap-1 rounded-sm font-mono text-[10px] font-medium tracking-normal text-primary normal-case outline-hidden transition-colors duration-200 hover:text-primary/80 hover:underline focus-visible:ring-1 focus-visible:ring-primary/60 motion-reduce:transition-none"
              >
                <BracesIcon className="size-3" /> script
              </span>
            ) : null}
          </>
        ) : (
          <span>Sub-agents</span>
        )}
        <span className="h-px flex-1 bg-primary/15" />
      </div>
      {/* A failed/errored workflow with no member rows would otherwise render
          as a bare header — surface the container itself so its status and
          error are visible. */}
      {group.workflow &&
      group.rest.length === 0 &&
      group.phases.every((phase) => phase.agents.length === 0) &&
      (group.workflow.status === "failed" ||
        group.workflow.status === "stopped" ||
        group.workflow.errorMessage) ? (
        <div className="space-y-1.5">
          <AgentCard agent={group.workflow} />
        </div>
      ) : null}
      {group.phases.map((phase) => (
        <div key={phase.index}>
          <PhaseHeader phase={phase} />
          <div className="space-y-1.5">
            {phase.agents.map((agent) => (
              <AgentCard key={agent.agentId} agent={agent} />
            ))}
          </div>
        </div>
      ))}
      {group.rest.length > 0 ? (
        <div className={cn("space-y-1.5", group.phases.length > 0 && "pt-2")}>
          {group.rest.map((agent) => (
            <AgentCard key={agent.agentId} agent={agent} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-1 pb-1 text-[10.5px] font-bold tracking-wider text-muted-foreground uppercase">
      <span>{children}</span>
      <span className="h-px flex-1 bg-primary/15" />
    </div>
  );
}

function SubagentsSection({
  activeRows,
  settledRows,
  settledExpanded,
  onSettledExpandedChange,
}: {
  activeRows: ReadonlyArray<AgentPanelRow>;
  settledRows: ReadonlyArray<AgentPanelRow>;
  settledExpanded: boolean;
  onSettledExpandedChange: (expanded: boolean) => void;
}) {
  if (activeRows.length === 0 && settledRows.length === 0) {
    return null;
  }

  return (
    <section aria-label="Sub-agents">
      <SectionHeader>Sub-agents</SectionHeader>
      {activeRows.length > 0 ? (
        <div className="space-y-1.5">
          {activeRows.map((row) => (
            <AgentCard key={row.agent.agentId} agent={row.agent} shells={row.shells} />
          ))}
        </div>
      ) : null}
      {settledRows.length > 0 ? (
        <>
          <button
            type="button"
            className={cn(
              "group/finished flex w-full items-center gap-1.5 rounded-sm pr-1 pb-1 pl-2 text-[10.5px] font-bold tracking-wider text-muted-foreground uppercase outline-hidden transition-colors duration-200 hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/60 motion-reduce:transition-none",
              activeRows.length > 0 && "mt-1.5",
            )}
            aria-label={`Finished sub-agents · ${settledRows.length}`}
            aria-expanded={settledExpanded}
            onClick={() => onSettledExpandedChange(!settledExpanded)}
          >
            <ChevronRightIcon
              className={cn(
                "size-3 transition-[color,transform] duration-200 ease-out group-hover/finished:text-primary motion-reduce:transition-none",
                settledExpanded && "rotate-90",
              )}
            />
            <span>Finished</span>
            <span className="font-medium tracking-normal">· {settledRows.length}</span>
            <span className="h-px flex-1 bg-primary/15" />
          </button>
          {settledExpanded ? (
            <div className="space-y-1.5">
              {settledRows.map((row) => (
                <AgentCard key={row.agent.agentId} agent={row.agent} shells={row.shells} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function BackgroundTasksSection({
  agents,
  expanded,
  onExpandedChange,
}: {
  agents: ReadonlyArray<ThreadAgentSnapshot>;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  if (agents.length === 0) {
    return null;
  }

  return (
    <section aria-label="Background tasks">
      <button
        type="button"
        className="group/background flex w-full items-center gap-1.5 rounded-sm px-1 pb-1 text-[10.5px] font-bold tracking-wider text-muted-foreground uppercase outline-hidden transition-colors duration-200 hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/60 motion-reduce:transition-none"
        aria-expanded={expanded}
        onClick={() => onExpandedChange(!expanded)}
      >
        <ChevronRightIcon
          className={cn(
            "size-3 transition-[color,transform] duration-200 ease-out group-hover/background:text-primary motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
        <span>Background tasks</span>
        <span className="font-medium tracking-normal">· {agents.length}</span>
        <span className="h-px flex-1 bg-primary/15" />
      </button>
      {expanded ? (
        <div className="space-y-1.5">
          {agents.map((agent) => (
            <AgentCard key={agent.agentId} agent={agent} showProviderIcon={false} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

const AgentsPanel = memo(function AgentsPanel({ agents, onOpenScript, mode }: AgentsPanelProps) {
  const state = deriveAgentPanelState(agents);
  // Resolved once for the whole roster, above the grouping: a card that moves
  // between `Sub-agents` and the `Finished` group keeps its identity
  // by agentId, so regrouping cannot manufacture a fresh arrival.
  const accents = useAgentLifecycleAccents(agents);
  // Finished starts open: the roster is usually consulted to read what a
  // completed sub-agent actually did, so hiding those behind a click buries
  // the thing most often being looked for.
  const [finishedExpanded, setFinishedExpanded] = useState(true);
  const [backgroundExpanded, setBackgroundExpanded] = useState(false);

  if (agents.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="mb-1 inline-flex rounded-xl border border-primary/15 bg-primary/8 p-2">
          <BotIcon className="size-6 text-primary/65" />
        </span>
        <p className="text-sm font-medium">No agents yet</p>
        <p className="text-xs text-muted-foreground">
          When this thread spawns subagents or runs a workflow, they show up here with live status
          and token usage.
        </p>
      </div>
    );
  }

  return (
    <AgentAccentContext.Provider value={accents}>
      <div className={cn("flex h-full min-h-0 flex-col", mode === "embedded" && "bg-transparent")}>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-3">
            {state.groups.map((group, index) => (
              <AgentGroup
                key={group.workflow?.agentId ?? `group-${index}`}
                group={group}
                onOpenScript={onOpenScript}
              />
            ))}
            <SubagentsSection
              activeRows={state.activeSubagents}
              settledRows={state.settledSubagents}
              settledExpanded={finishedExpanded}
              onSettledExpandedChange={setFinishedExpanded}
            />
            <BackgroundTasksSection
              agents={state.backgroundTasks}
              expanded={backgroundExpanded}
              onExpandedChange={setBackgroundExpanded}
            />
          </div>
        </ScrollArea>
        <div className="flex items-center gap-3 border-t border-primary/10 bg-primary/[0.025] px-3.5 py-2 text-[11px] text-muted-foreground">
          {state.runningCount > 0 ? (
            <span className="flex items-center gap-1.5 text-primary">
              <span className="size-1.75 rounded-full bg-primary shadow-[0_0_8px_var(--primary)] animate-status-pulse motion-reduce:animate-none" />
              {state.runningCount} running
            </span>
          ) : null}
          {state.waitingCount > 0 ? <span>{state.waitingCount} waiting</span> : null}
          {/* The quiet shared completion summary. Bulk and automatic
              settlement land here rather than on any per-card flourish. */}
          {state.settledCount > 0 ? <span>{state.settledCount} settled</span> : null}
          <span className="ml-auto font-mono tabular-nums">
            Σ {formatAgentTokenCount(state.totalTokens)} tok
          </span>
        </div>
      </div>
    </AgentAccentContext.Provider>
  );
});

export default AgentsPanel;
