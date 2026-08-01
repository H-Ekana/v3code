import { memo } from "react";
import type { ThreadAgentSnapshot } from "@t3tools/contracts";
import {
  deriveAgentPanelState,
  formatAgentTokenCount,
} from "@t3tools/client-runtime/state/thread-agents";
import { AlertTriangleIcon, BotIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "~/lib/utils";

/**
 * Collapsed one-line agent roster shown near the composer while agents are
 * live. Clicking opens the Agents panel — this strip is awareness only.
 */
const AgentsLiveStrip = memo(function AgentsLiveStrip({
  agents,
  onOpen,
  initialHydration = false,
}: {
  agents: ReadonlyArray<ThreadAgentSnapshot>;
  onOpen: () => void;
  /** Cached/catch-up state is historical and must not look newly live. */
  initialHydration?: boolean;
}) {
  const state = deriveAgentPanelState(agents);
  const liveCount = state.runningCount + state.waitingCount;
  // Background shells/monitors count toward liveness: a thread whose only
  // live work is a detached Codex job (kind "shell") still has agents the
  // user is waiting on, and hiding the strip made that work invisible.
  const backgroundCount = state.backgroundRunningCount;
  if (liveCount === 0 && backgroundCount === 0) {
    // Parent wrappers must not reserve space when nothing renders (the
    // caller keys visibility off hasLiveAgents with the same derivation).
    return null;
  }

  const runningPhase = state.groups
    .flatMap((group) => group.phases)
    .find((phase) => phase.status === "running");
  const failedActivityCount = agents.reduce(
    (total, agent) =>
      total + agent.recentActivity.filter((entry) => entry.outcome === "error").length,
    0,
  );
  const semanticActivity = agents.find(
    (agent) =>
      agent.status === "running" &&
      agent.currentActivityKind !== undefined &&
      agent.currentActivityKind !== "other",
  )?.currentActivityKind;
  const semanticActivityLabel = semanticActivity
    ? semanticActivity === "command"
      ? "Running command"
      : `${semanticActivity.charAt(0).toUpperCase()}${semanticActivity.slice(1)}`
    : null;
  const attentionLabel = [
    state.waitingCount > 0 ? `${state.waitingCount} need input` : null,
    failedActivityCount > 0 ? `${failedActivityCount} failed activities` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group/agents-live @container/agents-live mx-auto flex w-full max-w-[52rem] items-center gap-2 rounded-xl border border-primary/12 px-3 py-1.5 pointer-coarse:min-h-11",
        "bg-card/60 text-left text-xs outline-none transition-colors duration-200 hover:border-primary/25 hover:bg-card focus-visible:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none",
      )}
      aria-label={`${liveCount + backgroundCount} agents active${attentionLabel ? `, ${attentionLabel}` : ""} — open agents panel`}
    >
      <span
        aria-hidden
        data-agent-live-motion={initialHydration ? "static" : "live"}
        className={cn(
          "size-1.75 shrink-0 rounded-full bg-primary shadow-[0_0_8px_color-mix(in_srgb,var(--primary)_65%,transparent)] motion-reduce:animate-none",
          !initialHydration && "animate-status-pulse",
        )}
      />
      <BotIcon className="size-3.5 shrink-0 text-astro-highlight/80 transition-colors duration-200 group-hover/agents-live:text-astro-highlight motion-reduce:transition-none" />
      <span className="font-semibold">
        {liveCount > 0
          ? `${liveCount} agent${liveCount === 1 ? "" : "s"}`
          : `${backgroundCount} background task${backgroundCount === 1 ? "" : "s"}`}
      </span>
      {state.waitingCount > 0 ? (
        <span className="font-medium text-warning-foreground">{state.waitingCount} need input</span>
      ) : null}
      {failedActivityCount > 0 ? (
        <span className="inline-flex items-center gap-1 font-medium text-destructive-foreground">
          <AlertTriangleIcon className="size-3" />
          {failedActivityCount} failed
        </span>
      ) : null}
      {liveCount > 0 && backgroundCount > 0 ? (
        <span className="hidden text-muted-foreground @xl/agents-live:inline">
          {backgroundCount} background
        </span>
      ) : null}
      {semanticActivityLabel ? (
        <span className="min-w-0 truncate font-medium text-primary/85">
          {semanticActivityLabel}
        </span>
      ) : null}
      {runningPhase ? (
        <span className="hidden min-w-0 truncate text-muted-foreground @2xl/agents-live:inline">
          {runningPhase.title} ·{" "}
          {
            runningPhase.agents.filter(
              (a) => a.status === "running" || a.status === "pending" || a.status === "waiting",
            ).length
          }{" "}
          active
        </span>
      ) : null}
      <span className="hidden shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground @3xl/agents-live:inline">
        Σ {formatAgentTokenCount(state.totalTokens)}
      </span>
      <ChevronRightIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-colors duration-200 group-hover/agents-live:text-primary motion-reduce:transition-none" />
    </button>
  );
});

export default AgentsLiveStrip;
