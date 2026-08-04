import type {
  AgentTranscriptItem,
  ProviderDriverKind,
  ScopedThreadRef,
  ThreadAgentSnapshot,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownIcon,
  BotIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleDotIcon,
  CircleIcon,
  Clock3Icon,
  CopyIcon,
  GitCompareArrowsIcon,
  MessageSquarePlusIcon,
  TriangleAlertIcon,
} from "lucide-react";

import {
  formatAgentDisplayName,
  formatAgentObjective,
  formatAgentTokenCount,
} from "@t3tools/client-runtime/state/thread-agents";
import { cn } from "~/lib/utils";
import { formatProviderDisplayName } from "~/lib/contextWindow";
import { agentTranscriptEnvironment } from "~/state/agentTranscript";
import { useEnvironmentQuery } from "~/state/query";
import { formatElapsed } from "../session-logic";

import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import ChatMarkdown from "./ChatMarkdown";
import { AgentTranscriptConversation } from "./chat/AgentTranscriptConversation";
import { CollapsibleText } from "./chat/CollapsibleText";
import {
  deriveAgentActivityTranscriptItems,
  mergeCodexActivityWork,
  shouldPreferActivityFeed,
} from "./chat/agentActivityTranscript";
import { mergeAgentTranscriptPages } from "./chat/agentTranscriptPages";

interface AgentTranscriptPanelProps {
  agent: ThreadAgentSnapshot | null;
  fallbackName: string;
  threadRef?: ScopedThreadRef;
  sourceProvider?: ProviderDriverKind;
  agentId?: string;
  markdownCwd?: string | undefined;
  onOpenChanges?: (() => void) | undefined;
  onFollowUp?: ((agentName: string) => void) | undefined;
}

const STATUS_LABEL: Record<ThreadAgentSnapshot["status"], string> = {
  pending: "Queued",
  running: "Running",
  waiting: "Waiting for input",
  idle: "Finished · resumable",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

const ACTIVITY_LABEL: Record<NonNullable<ThreadAgentSnapshot["currentActivityKind"]>, string> = {
  reasoning: "Reasoning",
  planning: "Planning",
  investigating: "Investigating",
  editing: "Implementing",
  command: "Running command",
  verifying: "Verifying",
  reviewing: "Reviewing",
  delegating: "Delegating",
  reporting: "Reporting",
  waiting: "Waiting",
  other: "Working",
};

function relativeTime(timestamp: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(timestamp).getTime());
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1_000)}s ago`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  return `${Math.floor(elapsed / 3_600_000)}h ago`;
}

export function formatAgentHealth(agent: ThreadAgentSnapshot, now = Date.now()): string | null {
  if (agent.status === "pending") return "Queued";
  if (agent.status === "waiting") return "Waiting for input";
  if (agent.status !== "running") return null;
  const lastActivityAt = Date.parse(agent.lastActivityAt);
  if (Number.isNaN(lastActivityAt)) return "Working";
  const elapsed = Math.max(0, now - lastActivityAt);
  if (elapsed < 60_000) return "Active now";
  const minutes = Math.floor(elapsed / 60_000);
  return elapsed < 120_000 ? `Active ${minutes}m ago` : `No activity for ${minutes}m`;
}

export interface AgentWorkChip {
  readonly label: string;
  readonly tone: "neutral" | "error";
}

/**
 * A breakdown of what the agent did, by disjoint category.
 *
 * Deliberately does NOT restate a total: the roster's `usage.toolUses` is the
 * authoritative count for the whole agent, while this is derived from the
 * transcript page in hand, and printing both produced two different tool-call
 * numbers side by side. Every work item has exactly one `category`, so these
 * chips partition rather than overlap — "1 command · 2 searches" never
 * double-counts the same call.
 *
 * Categories map identically across providers: Claude tool names are
 * classified into the same lifecycle types Codex's item types already use, so
 * a Codex sub-agent produces the same vocabulary here.
 */
/**
 * `tool` and `other` are deliberately absent. They are the residual buckets —
 * "everything not worth naming" — and the meta row above already prints the
 * authoritative total. Emitting a chip for the remainder produced "5 tool
 * calls" and "3 tool calls" a line apart, which reads as a contradiction even
 * though the categories partition correctly.
 */
const WORK_CATEGORY_NOUNS: Record<string, { one: string; many: string }> = {
  command: { one: "command", many: "commands" },
  files: { one: "file edit", many: "file edits" },
  search: { one: "search", many: "searches" },
  delegation: { one: "delegation", many: "delegations" },
};

export function summarizeAgentWork(
  items: ReadonlyArray<AgentTranscriptItem>,
): ReadonlyArray<AgentWorkChip> {
  const work = items.filter((item): item is WorkItem => item.kind === "work");
  const counts = new Map<string, number>();
  for (const item of work) {
    // Thinking is reasoning, not work the agent performed.
    if (item.category === "thinking") continue;
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }

  const chips: Array<AgentWorkChip> = [];
  for (const category of ["command", "files", "search", "delegation"]) {
    const count = counts.get(category) ?? 0;
    if (count === 0) continue;
    const noun = WORK_CATEGORY_NOUNS[category];
    if (!noun) continue;
    chips.push({ label: `${count} ${count === 1 ? noun.one : noun.many}`, tone: "neutral" });
  }

  const changedFiles = new Set(work.flatMap((item) => item.changedFiles ?? []));
  if (changedFiles.size > 0) {
    chips.push({
      label: `${changedFiles.size} ${changedFiles.size === 1 ? "file" : "files"} changed`,
      tone: "neutral",
    });
  }
  const failures = work.filter((item) => item.status === "failed").length;
  if (failures > 0) chips.push({ label: `${failures} failed`, tone: "error" });
  return chips;
}

/**
 * A transcript that is mostly tool calls read as "1 message" — technically
 * true and wildly misleading about how much is below. Counting both halves
 * describes the section honestly for either provider.
 */
export function formatTranscriptSummaryLabel(items: ReadonlyArray<AgentTranscriptItem>): string {
  const messages = items.filter((item) => item.kind === "message").length;
  const work = items.filter((item) => item.kind === "work" && item.category !== "thinking").length;
  const parts = [
    ...(messages > 0 ? [`${messages} ${messages === 1 ? "message" : "messages"}`] : []),
    ...(work > 0 ? [`${work} tool ${work === 1 ? "call" : "calls"}`] : []),
  ];
  return parts.length > 0 ? parts.join(" · ") : "No visible activity";
}

export function summarizeCompletionEvidence(
  items: ReadonlyArray<AgentTranscriptItem>,
): ReadonlyArray<string> {
  const work = items.filter((item): item is WorkItem => item.kind === "work");
  const completed = work.filter((item) => item.status === "completed").length;
  const failed = work.filter((item) => item.status === "failed").length;
  const changedFiles = work
    .filter((item) => item.category === "files")
    .reduce((total, item) => total + (Number(item.label.match(/^Changed (\d+)/)?.[1]) || 0), 0);
  return [
    ...(completed > 0 ? [`${completed} completed work ${completed === 1 ? "step" : "steps"}`] : []),
    ...(changedFiles > 0
      ? [`${changedFiles} changed ${changedFiles === 1 ? "file" : "files"}`]
      : []),
    ...(failed > 0 ? [`${failed} failed ${failed === 1 ? "step" : "steps"}`] : []),
  ];
}

export function compactTechnicalActivity(
  entries: ThreadAgentSnapshot["recentActivity"],
  hideReporting = false,
): ThreadAgentSnapshot["recentActivity"] {
  const result: ThreadAgentSnapshot["recentActivity"][number][] = [];
  const positions = new Map<string, number>();
  for (const entry of entries) {
    const summary = entry.summary.trim();
    if (hideReporting && entry.kind === "reporting") continue;
    if (!summary || (entry.kind === "reasoning" && summary.toLowerCase() === "reasoning")) continue;
    const key = `${entry.kind ?? "activity"}:${summary}`;
    const priorIndex = positions.get(key);
    if (priorIndex === undefined) {
      positions.set(key, result.length);
      result.push(entry);
    } else if (result[priorIndex]?.lifecycle === "started" && entry.lifecycle !== "started") {
      result[priorIndex] = entry;
    }
  }
  return result;
}

type WorkItem = Extract<import("@t3tools/contracts").AgentTranscriptItem, { kind: "work" }>;

function isTerminalStatus(status: ThreadAgentSnapshot["status"]): boolean {
  return status === "completed" || status === "failed" || status === "stopped" || status === "idle";
}

type TranscriptMessage = Extract<AgentTranscriptItem, { kind: "message" }>;

function normalizedTranscriptText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function omitDuplicateObjective(
  items: ReadonlyArray<AgentTranscriptItem>,
  objective: string | undefined,
): ReadonlyArray<AgentTranscriptItem> {
  if (!objective) return items;
  const firstMessageIndex = items.findIndex((item) => item.kind === "message");
  const firstMessage = items[firstMessageIndex];
  if (
    firstMessage?.kind !== "message" ||
    firstMessage.role !== "user" ||
    normalizedTranscriptText(firstMessage.text) !== normalizedTranscriptText(objective)
  ) {
    return items;
  }
  return items.filter((_, index) => index !== firstMessageIndex);
}

/**
 * `complete` gates the fallback because "the last assistant message we hold" is
 * only the outcome when we hold the *end* of the transcript. Paging starts at
 * the beginning, so on a long agent the last message of page one is mid-work
 * commentary — presenting that as the result is worse than presenting nothing.
 * A provider-declared `final` phase needs no such gate.
 */
export function findFinalTranscriptMessage(
  items: ReadonlyArray<AgentTranscriptItem>,
  status: ThreadAgentSnapshot["status"],
  complete: boolean,
): TranscriptMessage | null {
  const explicitFinal = items.findLast(
    (item): item is TranscriptMessage =>
      item.kind === "message" && item.role === "assistant" && item.phase === "final",
  );
  if (explicitFinal) return explicitFinal;
  if (!isTerminalStatus(status) || !complete) return null;
  return (
    items.findLast(
      (item): item is TranscriptMessage => item.kind === "message" && item.role === "assistant",
    ) ?? null
  );
}

/**
 * Describes who is doing the work and who is hosting it.
 *
 * `provider` is the adapter that emitted the events; `delegateProvider` is the
 * provider actually working. When they differ, `model` belongs to the *host*,
 * so pairing it with the delegate's name renders "Codex · claude-sonnet-5" — a
 * card contradicting itself. The host is named explicitly instead, and the
 * misleading model is dropped rather than silently attributed to the delegate.
 */
export function formatAgentIdentityLine(
  agent: ThreadAgentSnapshot,
  displayProvider: (provider: ThreadAgentSnapshot["provider"]) => string,
): string {
  const delegate = agent.delegateProvider;
  const isDelegated = delegate !== undefined && delegate !== agent.provider;
  if (isDelegated) {
    return `${displayProvider(delegate)} job · hosted by ${displayProvider(agent.provider)}`;
  }
  return [
    displayProvider(agent.provider),
    ...(agent.model ? [agent.model] : []),
    ...(agent.reasoningEffort ? [`${agent.reasoningEffort} reasoning`] : []),
  ].join(" · ");
}

export function formatAgentCompletionSummary(agent: ThreadAgentSnapshot): string | null {
  if (agent.status !== "completed" && agent.status !== "idle") return null;
  const duration = formatElapsed(
    agent.firstStartedAt,
    agent.endedAt ?? agent.lastActivityAt ?? agent.updatedAt,
  );
  const runs = `${agent.activationCount} ${agent.activationCount === 1 ? "run" : "runs"}`;
  return `${duration ? `Completed in ${duration}` : "Completed"} · ${runs}`;
}

function Plan({ agent }: { agent: ThreadAgentSnapshot }) {
  if (!agent.plan?.length) return null;
  const completed = agent.plan.filter((step) => step.status === "completed").length;
  return (
    <section className="space-y-2" aria-label="Agent plan">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium text-foreground">Plan</h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          {completed}/{agent.plan.length} complete
        </span>
      </div>
      <ol className="space-y-1.5">
        {agent.plan.map((step) => (
          <li key={`${step.status}:${step.step}`} className="flex gap-2 text-xs leading-5">
            {step.status === "completed" ? (
              <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-success" />
            ) : step.status === "inProgress" ? (
              <CircleDotIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
            ) : (
              <CircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" />
            )}
            <span className={cn(step.status === "completed" && "text-muted-foreground")}>
              {step.step}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function AgentTranscriptPanel({
  agent,
  fallbackName,
  threadRef,
  sourceProvider,
  agentId,
  markdownCwd,
  onOpenChanges,
  onFollowUp,
}: AgentTranscriptPanelProps) {
  const transcriptKey =
    threadRef && sourceProvider && agentId
      ? `${threadRef.environmentId}:${threadRef.threadId}:${sourceProvider}:${agentId}`
      : "";
  const [cursor, setCursor] = useState<number | undefined>();
  const [loaded, setLoaded] = useState<{
    key: string;
    items: ReadonlyArray<AgentTranscriptItem>;
    nextCursor?: number;
    complete: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showNewUpdates, setShowNewUpdates] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const wasNearBottomRef = useRef(true);
  const previousItemCountRef = useRef(0);
  const transcript = useEnvironmentQuery(
    threadRef && sourceProvider && agentId
      ? agentTranscriptEnvironment.transcript({
          environmentId: threadRef.environmentId,
          input: {
            threadId: threadRef.threadId,
            sourceProvider,
            agentId,
            ...(cursor === undefined ? {} : { cursor }),
            limit: 100,
          },
        })
      : null,
  );

  /**
   * The transcript is fetched once when the panel opens and never again, so an
   * agent that settles while you are watching keeps its mid-run page forever.
   * That is not just staleness: the outcome card reads the *tail* of whatever
   * page is held, so a stale page promotes mid-work commentary ("Now let me
   * check the…") to the headline result.
   *
   * Refreshing on the settle transition rather than on every roster revision is
   * deliberate — revision bumps many times a second while an agent works, and
   * each refetch re-reads the provider's session log.
   */
  /**
   * Deliberately excludes `updatedAt`. `idle` counts as terminal here but is
   * not in `THREAD_AGENT_TERMINAL_STATUSES`, so the server never stamps
   * `endedAt` for it — falling back to `updatedAt` minted a fresh token on
   * every roster event and re-read the provider session log each time, which
   * is exactly the per-revision refetch this token exists to avoid. Status and
   * activation count already change on every transition worth re-reading for.
   */
  const settleToken =
    agent && isTerminalStatus(agent.status)
      ? `${transcriptKey}:${agent.status}:${agent.activationCount}:${agent.endedAt ?? ""}`
      : null;
  const settleRefreshedRef = useRef<{ key: string; token: string | null } | null>(null);
  const refreshTranscript = transcript.refresh;
  useEffect(() => {
    const seen = settleRefreshedRef.current;
    // First sight of this agent: whatever the query just fetched is the
    // baseline, so an agent that was already settled on open needs no refresh.
    if (seen === null || seen.key !== transcriptKey) {
      settleRefreshedRef.current = { key: transcriptKey, token: settleToken };
      return;
    }
    if (settleToken === null || seen.token === settleToken) return;
    settleRefreshedRef.current = { key: transcriptKey, token: settleToken };
    refreshTranscript();
  }, [refreshTranscript, settleToken, transcriptKey]);

  useEffect(() => {
    setCursor(undefined);
    setLoaded(null);
    setShowNewUpdates(false);
    wasNearBottomRef.current = true;
    previousItemCountRef.current = 0;
  }, [transcriptKey]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updatePosition = () => {
      wasNearBottomRef.current =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 48;
      if (wasNearBottomRef.current) setShowNewUpdates(false);
    };
    updatePosition();
    viewport.addEventListener("scroll", updatePosition, { passive: true });
    return () => viewport.removeEventListener("scroll", updatePosition);
  }, [transcriptKey]);

  useEffect(() => {
    if (transcript.data?.status !== "available") return;
    const page = transcript.data;
    setLoaded((current) => ({
      key: transcriptKey,
      items:
        current?.key === transcriptKey
          ? // Merged rather than replaced even at cursor 0: a settle refresh
            // re-reads page 1, and its items supersede the copies held from
            // when the agent was still running.
            mergeAgentTranscriptPages(current.items, page.items)
          : page.items,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      complete: page.complete,
    }));
  }, [transcript.data, transcriptKey]);

  const loadedItemCount =
    loaded?.key === transcriptKey
      ? loaded.items.length
      : transcript.data?.status === "available"
        ? transcript.data.items.length
        : 0;

  useEffect(() => {
    const previousCount = previousItemCountRef.current;
    previousItemCountRef.current = loadedItemCount;
    if (previousCount === 0 || loadedItemCount <= previousCount) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (wasNearBottomRef.current) {
      viewport.scrollTo({ top: viewport.scrollHeight });
    } else {
      setShowNewUpdates(true);
    }
  }, [loadedItemCount]);

  if (!agent) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6 text-center">
        <div className="max-w-sm space-y-2">
          <BotIcon className="mx-auto size-5 text-muted-foreground" />
          <p className="text-sm font-medium">{fallbackName}</p>
          <p className="text-xs leading-5 text-muted-foreground">
            This agent is no longer present in the latest roster snapshot.
          </p>
        </div>
      </div>
    );
  }

  const identityLine = formatAgentIdentityLine(agent, formatProviderDisplayName);
  const agentName = formatAgentDisplayName(agent.name);
  const objective = agent.objective ? formatAgentObjective(agent.name, agent.objective) : null;
  const currentKind = agent.currentActivityKind ? ACTIVITY_LABEL[agent.currentActivityKind] : null;
  const availableTranscript =
    loaded?.key === transcriptKey
      ? loaded
      : transcript.data?.status === "available"
        ? transcript.data
        : null;
  const conversationItems = availableTranscript
    ? omitDuplicateObjective(availableTranscript.items, agent.objective)
    : [];
  const transcriptMessageCount = availableTranscript
    ? conversationItems.filter((item) => item.kind === "message").length
    : 0;
  const technicalActivity = compactTechnicalActivity(
    agent.recentActivity,
    transcriptMessageCount > 0,
  );
  /**
   * Source selection happens before anything is derived, so the header, the
   * outcome card and the conversation all describe the same record. Deriving
   * chips from the transcript while rendering the feed produced a header that
   * contradicted the section directly beneath it.
   */
  const activityItems = deriveAgentActivityTranscriptItems(agent.recentActivity);
  const transcriptState =
    availableTranscript !== null
      ? "available"
      : transcript.data !== null && transcript.data !== undefined
        ? "unavailable"
        : "pending";
  const usingActivityFeed = shouldPreferActivityFeed({
    isDelegated: agent.delegateProvider !== undefined && agent.delegateProvider !== agent.provider,
    transcriptState,
    activityWorkCount: activityItems.filter((item) => item.kind === "work").length,
  });
  /**
   * Codex is the one provider whose transcript is missing work it actually
   * did, so its children get the feed folded in rather than swapped for it.
   * Every other provider renders its transcript untouched.
   */
  const sourceItems = usingActivityFeed
    ? activityItems
    : agent.provider === "codex"
      ? mergeCodexActivityWork(conversationItems, activityItems)
      : conversationItems;
  /**
   * The feed is always the newest 50 entries, so it necessarily contains the
   * end of the run; a transcript page only does once it reports `complete`.
   */
  const sourceReachesEnd = usingActivityFeed ? true : (availableTranscript?.complete ?? false);

  const finalMessage = findFinalTranscriptMessage(sourceItems, agent.status, sourceReachesEnd);
  const outcomeText = finalMessage?.text ?? agent.resultSummary ?? null;
  const completionSummary = formatAgentCompletionSummary(agent);
  const health = formatAgentHealth(agent);
  const completionEvidence = summarizeCompletionEvidence(sourceItems);
  const workSummary = summarizeAgentWork(sourceItems);
  const hasFileChanges = sourceItems.some(
    (item) => item.kind === "work" && item.category === "files",
  );
  /**
   * The final answer already headlines the panel in the outcome card, so it is
   * dropped from the transcript rather than rendered twice. Everything leading
   * up to it stays, which is what the conversation is for.
   */
  const conversationSource =
    finalMessage && outcomeText === finalMessage.text
      ? sourceItems.filter((item) => item.id !== finalMessage.id)
      : sourceItems;
  /**
   * The conversation section only exists when the panel can address a
   * transcript at all. Without it the feed has nowhere to be promoted to, so
   * the collapsed fallback below is the only record left.
   */
  const conversationRendered =
    Boolean(threadRef && sourceProvider && agentId) && conversationSource.length > 0;
  /** Describes what the transcript actually renders, not what was fetched. */
  const transcriptSummaryLabel = formatTranscriptSummaryLabel(conversationSource);

  return (
    <ScrollArea className="h-full min-h-0" viewportRef={viewportRef}>
      <article className="mx-auto max-w-3xl space-y-5 px-4 py-5 sm:px-6">
        <header className="space-y-3 border-b border-border/60 pb-4">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-foreground">{agentName}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{identityLine}</p>
            </div>
            <Badge variant="outline" className="shrink-0 text-xs">
              {STATUS_LABEL[agent.status]}
            </Badge>
          </div>
          {objective ? (
            <div>
              {/*
                This text is the prompt the spawning agent wrote, not anything
                the reader typed. Saying so here is what "Objective" alone
                never did — and it is the same relationship for every provider,
                since a Codex child's prompt also comes from its parent.
              */}
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Task from the main agent
              </p>
              <CollapsibleText
                text={objective}
                className="text-foreground/90"
                expandLabel="Show full task"
                collapseLabel="Show less"
              />
            </div>
          ) : null}
          {/*
            One meta row. `usage.toolUses` is the authoritative total for the
            whole agent; the chips below it are a disjoint breakdown of the
            transcript in hand. Printing a second total alongside produced two
            different tool-call counts inches apart.
          */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {currentKind ? <span>{currentKind}</span> : null}
            {health && health !== currentKind ? <span>{health}</span> : null}
            {agent.usage ? (
              <span>{formatAgentTokenCount(agent.usage.totalTokens)} tokens</span>
            ) : null}
            {agent.usage?.toolUses !== undefined ? (
              <span>{agent.usage.toolUses} tool calls</span>
            ) : null}
            <span>
              {agent.activationCount} {agent.activationCount === 1 ? "run" : "runs"}
            </span>
          </div>
          {workSummary.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {workSummary.map((chip) => (
                <span
                  key={chip.label}
                  className={cn(
                    "rounded-md border px-1.5 py-0.5 text-[11px]",
                    chip.tone === "error"
                      ? "border-destructive/30 bg-destructive/10 text-destructive"
                      : "border-border/70 text-muted-foreground",
                  )}
                >
                  {chip.label}
                </span>
              ))}
            </div>
          ) : null}
        </header>

        {outcomeText ? (
          <section
            className="rounded-lg border border-primary/20 bg-primary/[0.055] px-3.5 py-3"
            aria-label="Agent outcome"
          >
            <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                <CheckCircle2Icon className="size-3.5 text-primary" />
                Final result
              </span>
              {completionSummary ? (
                <span className="text-muted-foreground">{completionSummary}</span>
              ) : null}
            </div>
            <ChatMarkdown
              text={outcomeText}
              cwd={markdownCwd}
              threadRef={threadRef}
              className="text-foreground/90"
            />
            {completionEvidence.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">{completionEvidence.join(" · ")}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2 border-t border-primary/10 pt-2.5">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(outcomeText).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1_500);
                  });
                }}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
              >
                <CopyIcon className="size-3.5" />
                {copied ? "Copied" : "Copy result"}
              </button>
              {onOpenChanges && hasFileChanges ? (
                <button
                  type="button"
                  onClick={onOpenChanges}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                >
                  <GitCompareArrowsIcon className="size-3.5" />
                  View changes
                </button>
              ) : null}
              {onFollowUp && isTerminalStatus(agent.status) ? (
                <button
                  type="button"
                  onClick={() => onFollowUp(agentName)}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                >
                  <MessageSquarePlusIcon className="size-3.5" />
                  Follow up
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        <Plan agent={agent} />

        {threadRef && sourceProvider && agentId ? (
          <section className="space-y-2" aria-label="Provider conversation transcript">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-medium text-foreground">Conversation</h3>
              {conversationSource.length > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {transcriptSummaryLabel}
                  {!usingActivityFeed && availableTranscript && !availableTranscript.complete
                    ? " · more available"
                    : ""}
                </span>
              ) : null}
            </div>
            {usingActivityFeed ? (
              <p className="text-xs leading-5 text-muted-foreground">
                This agent delegated its work to a background job, so this is the job's live
                activity rather than a full provider transcript — no tool arguments or outputs.
              </p>
            ) : null}
            {/*
              A read failure is reported before any fallback content: the feed
              is a different, thinner record, and silently substituting it
              would present a broken read as a successful one.
            */}
            {transcript.error && !usingActivityFeed ? (
              <p className="text-xs leading-5 text-muted-foreground">
                The conversation is temporarily unavailable.
              </p>
            ) : transcript.isPending && conversationSource.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                Loading conversation…
              </p>
            ) : conversationSource.length > 0 ? (
              <AgentTranscriptConversation
                items={conversationSource}
                threadRef={threadRef}
                markdownCwd={markdownCwd}
              />
            ) : transcript.data?.status === "available" ? (
              <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                The provider returned no visible messages for this agent.
              </p>
            ) : transcript.data ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-xs leading-5 text-muted-foreground">
                {transcript.data.message}
              </p>
            ) : null}
            {!usingActivityFeed &&
            availableTranscript &&
            !availableTranscript.complete &&
            availableTranscript.nextCursor !== undefined ? (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  disabled={transcript.isPending}
                  onClick={() => setCursor(availableTranscript.nextCursor)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border/70 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                >
                  <ArrowDownIcon className="size-3.5" />
                  {transcript.isPending ? "Loading more…" : "Load more activity"}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {agent.errorMessage ? (
          <section className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-destructive">
              <TriangleAlertIcon className="size-3.5" />
              Agent error
            </div>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-foreground/85">
              {agent.errorMessage}
            </p>
          </section>
        ) : null}

        {/*
          Last resort only. The feed is normally either redundant with the
          transcript or already promoted into the conversation above, so it
          renders here just when neither source produced anything.
        */}
        {!conversationRendered && technicalActivity.length > 0 ? (
          <details className="group border-t border-border/60 pt-3" aria-label="Technical activity">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              <span className="font-medium text-foreground">Technical activity</span>
              <span className="text-muted-foreground">
                {technicalActivity.length} {technicalActivity.length === 1 ? "event" : "events"}
              </span>
            </summary>
            <ol className="mt-2 divide-y divide-border/50 border-y border-border/60">
              {technicalActivity.map((entry) => (
                <li
                  key={`${entry.at}:${entry.kind ?? "activity"}:${entry.lifecycle ?? "event"}:${entry.summary}`}
                  className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 py-2.5"
                >
                  <span
                    className={cn(
                      "mt-1.5 size-1.5 rounded-full",
                      entry.outcome === "error"
                        ? "bg-destructive"
                        : entry.lifecycle === "started"
                          ? "bg-primary"
                          : "bg-muted-foreground/45",
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <span className="text-xs font-medium text-foreground/90">
                        {entry.kind ? ACTIVITY_LABEL[entry.kind] : "Activity"}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                        <Clock3Icon className="size-3" />
                        {relativeTime(entry.at)}
                      </span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-muted-foreground">
                      {entry.summary}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
        {showNewUpdates ? (
          <div className="pointer-events-none sticky bottom-3 z-10 flex justify-center">
            <button
              type="button"
              onClick={() => {
                viewportRef.current?.scrollTo({
                  top: viewportRef.current.scrollHeight,
                  behavior: "smooth",
                });
                setShowNewUpdates(false);
              }}
              className="pointer-events-auto inline-flex min-h-9 items-center gap-1.5 rounded-full border border-primary/25 bg-background/95 px-3 text-xs font-medium text-foreground shadow-lg backdrop-blur"
            >
              <ArrowDownIcon className="size-3.5 text-primary" />
              New updates
            </button>
          </div>
        ) : null}
      </article>
    </ScrollArea>
  );
}
