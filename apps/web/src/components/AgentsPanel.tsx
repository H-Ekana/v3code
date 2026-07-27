import { memo, useEffect, useRef, useState } from "react";
import type { ThreadAgentSnapshot } from "@t3tools/contracts";
import {
  deriveAgentPanelState,
  formatAgentTokenCount,
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
import { parseTimestampDate } from "../timestampFormat";
import { formatProviderDisplayName } from "../lib/contextWindow";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";

interface AgentsPanelProps {
  agents: ReadonlyArray<ThreadAgentSnapshot>;
  onOpenScript?: (scriptPath: string) => void;
  mode?: "sheet" | "sidebar" | "embedded";
}

const STATUS_DOT_CLASS: Record<ThreadAgentSnapshot["status"], string> = {
  pending: "bg-muted-foreground/40",
  running: "bg-primary animate-status-pulse motion-reduce:animate-none",
  waiting: "bg-warning animate-status-pulse motion-reduce:animate-none",
  idle: "bg-primary/50",
  completed: "bg-success",
  failed: "bg-destructive",
  stopped: "bg-muted-foreground/60",
};

const STATUS_LABEL: Record<ThreadAgentSnapshot["status"], string> = {
  pending: "Queued",
  running: "Running",
  waiting: "Waiting",
  idle: "Idle · resumable",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

const EMPTY_AGENT_SNAPSHOTS: ReadonlyArray<ThreadAgentSnapshot> = [];

function AgentStatusDot({ status }: { status: ThreadAgentSnapshot["status"] }) {
  return (
    <span
      className={cn("size-1.75 shrink-0 rounded-full", STATUS_DOT_CLASS[status])}
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
        className="relative isolate inline-flex size-5 shrink-0"
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
          statusDotClassName={STATUS_DOT_CLASS[agent.status]}
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
function AgentElapsed({ agent }: { agent: ThreadAgentSnapshot }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const settled = isTerminalAgentStatus(agent.status) || agent.status === "idle";
  // Current-activation start (falls back to firstStartedAt for pre-field
  // snapshots) so a resumed agent's timer excludes prior runs and idle gaps.
  const startMs =
    parseTimestampDate(agent.lastStartedAt ?? agent.firstStartedAt)?.getTime() ?? null;
  const endMs =
    (agent.endedAt ? parseTimestampDate(agent.endedAt)?.getTime() : null) ??
    (settled ? (parseTimestampDate(agent.lastActivityAt)?.getTime() ?? null) : null);
  const initialText =
    startMs === null ? null : formatDuration(Math.max(0, (endMs ?? Date.now()) - startMs));

  useEffect(() => {
    if (startMs === null || endMs !== null) return;
    const update = () => {
      if (textRef.current) {
        textRef.current.textContent = formatDuration(Math.max(0, Date.now() - startMs));
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startMs, endMs]);

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

  return (
    <button
      type="button"
      onClick={() => hasDetails && setExpanded((value) => !value)}
      aria-expanded={hasDetails ? expanded : undefined}
      className={cn(
        "group/agent w-full rounded-lg border border-border/60 bg-card px-3 py-2 text-left outline-hidden transition-[background-color,border-color,box-shadow,opacity] duration-200 ease-out focus-visible:ring-1 focus-visible:ring-primary/60 motion-reduce:transition-none",
        hasDetails ? "cursor-pointer hover:border-primary/25" : "cursor-default",
        isLive && "border-primary/20 bg-primary/[0.035] shadow-[0_0_8px_-4px_var(--primary)]",
        agent.status === "waiting" && "border-warning/25",
        settled && "opacity-80",
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
        {agent.model ? (
          <Badge variant="outline" size="sm" className="shrink-0 text-muted-foreground">
            {agent.model}
          </Badge>
        ) : null}
        <span className="ml-auto shrink-0">
          <AgentElapsed agent={agent} />
        </span>
        {agent.status === "completed" ? (
          <CheckIcon className="size-3 shrink-0 text-success" />
        ) : null}
      </div>
      {activity ? (
        <div
          className={cn(
            "mt-1 truncate text-[11.5px]",
            agent.status === "failed" ? "text-destructive-foreground" : "text-muted-foreground",
          )}
        >
          {activity}
        </div>
      ) : null}
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        {agent.usage ? (
          <span className="font-mono tabular-nums text-foreground">
            {formatAgentTokenCount(agent.usage.totalTokens)}{" "}
            <span className="text-muted-foreground">tok</span>
            {agent.status === "running" ? <span className="text-sky-500"> ↑</span> : null}
          </span>
        ) : null}
        {agent.usage?.toolUses ? (
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
      {expanded && hasDetails ? (
        <div className="mt-2 space-y-0.5 border-t border-primary/15 pt-2">
          {agent.recentActivity.toReversed().map((entry) => (
            <div key={`${entry.at}-${entry.summary}`} className="flex gap-2 text-[11px]">
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground/60">
                {entry.at.slice(11, 19)}
              </span>
              <span className="truncate text-muted-foreground">{entry.summary}</span>
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
        </div>
      ) : null}
    </button>
  );
}

function PhaseHeader({ phase }: { phase: AgentPanelPhase }) {
  // "active" (not just status==="running"): a phase whose agents are all
  // pending/waiting is still in progress and must not read "0 running".
  const doneCount = phase.agents.filter(
    (agent) => agent.status === "idle" || isTerminalAgentStatus(agent.status),
  ).length;
  const activeCount = phase.agents.length - doneCount;
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
        <span>
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

function SubagentsSection({ rows }: { rows: ReadonlyArray<AgentPanelRow> }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <section aria-label="Sub-agents">
      <SectionHeader>Sub-agents</SectionHeader>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <AgentCard key={row.agent.agentId} agent={row.agent} shells={row.shells} />
        ))}
      </div>
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
          <SubagentsSection rows={state.subagents} />
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
        {state.settledCount > 0 ? <span>{state.settledCount} settled</span> : null}
        <span className="ml-auto font-mono tabular-nums">
          Σ {formatAgentTokenCount(state.totalTokens)} tok
        </span>
      </div>
    </div>
  );
});

export default AgentsPanel;
