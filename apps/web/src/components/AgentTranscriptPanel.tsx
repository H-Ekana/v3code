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
  FilePenLineIcon,
  GitCompareArrowsIcon,
  MessageSquarePlusIcon,
  SearchIcon,
  TerminalIcon,
  TriangleAlertIcon,
  WrenchIcon,
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

function WorkStep({ item }: { item: WorkItem }) {
  const Icon =
    item.category === "command"
      ? TerminalIcon
      : item.category === "files"
        ? FilePenLineIcon
        : item.category === "search"
          ? SearchIcon
          : WrenchIcon;
  return (
    <details className="group rounded-md border border-border/60 bg-muted/15 open:bg-muted/25">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground/85">{item.label}</span>
        <span
          className={cn(
            "shrink-0 text-[11px]",
            item.status === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {item.status === "running" ? "Running" : item.status === "failed" ? "Failed" : "Done"}
        </span>
      </summary>
      {item.detail || item.outcome ? (
        <div className="space-y-2 border-t border-border/50 px-3 py-2.5 pl-8">
          {item.detail ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-muted-foreground">
              {item.detail}
            </pre>
          ) : null}
          {item.outcome ? (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs leading-5 text-muted-foreground">
              {item.outcome}
            </pre>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

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

export function findFinalTranscriptMessage(
  items: ReadonlyArray<AgentTranscriptItem>,
  status: ThreadAgentSnapshot["status"],
): TranscriptMessage | null {
  const explicitFinal = items.findLast(
    (item): item is TranscriptMessage =>
      item.kind === "message" && item.role === "assistant" && item.phase === "final",
  );
  if (explicitFinal) return explicitFinal;
  if (!isTerminalStatus(status)) return null;
  return (
    items.findLast(
      (item): item is TranscriptMessage => item.kind === "message" && item.role === "assistant",
    ) ?? null
  );
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
        cursor === undefined || current?.key !== transcriptKey
          ? page.items
          : [
              ...current.items,
              ...page.items.filter(
                (item) => !current.items.some((existing) => existing.id === item.id),
              ),
            ],
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      complete: page.complete,
    }));
  }, [cursor, transcript.data, transcriptKey]);

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

  const provider = agent.delegateProvider ?? agent.provider;
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
  const visibleMessageCount = availableTranscript
    ? conversationItems.filter((item) => item.kind === "message").length
    : 0;
  const technicalActivity = compactTechnicalActivity(agent.recentActivity, visibleMessageCount > 0);
  const finalMessage = findFinalTranscriptMessage(conversationItems, agent.status);
  const outcomeText = finalMessage?.text ?? agent.resultSummary ?? null;
  const completionSummary = formatAgentCompletionSummary(agent);
  const health = formatAgentHealth(agent);
  const completionEvidence = summarizeCompletionEvidence(conversationItems);
  const hasFileChanges = conversationItems.some(
    (item) => item.kind === "work" && item.category === "files",
  );

  return (
    <ScrollArea className="h-full min-h-0" viewportRef={viewportRef}>
      <article className="mx-auto max-w-3xl space-y-5 px-4 py-5 sm:px-6">
        <header className="space-y-3 border-b border-border/60 pb-4">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-foreground">{agentName}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatProviderDisplayName(provider)}
                {agent.model ? ` · ${agent.model}` : ""}
                {agent.reasoningEffort ? ` · ${agent.reasoningEffort} reasoning` : ""}
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 text-xs">
              {STATUS_LABEL[agent.status]}
            </Badge>
          </div>
          {objective ? (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Objective</p>
              <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/90">
                {objective}
              </p>
            </div>
          ) : null}
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
              {transcript.data?.status === "available" ? (
                <span className="text-xs text-muted-foreground">
                  {visibleMessageCount} {visibleMessageCount === 1 ? "message" : "messages"}
                  {availableTranscript?.complete ? "" : " · more available"}
                </span>
              ) : null}
            </div>
            {transcript.isPending ? (
              <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                Loading conversation…
              </p>
            ) : transcript.error ? (
              <p className="text-xs leading-5 text-muted-foreground">
                The conversation is temporarily unavailable. Technical activity can still be viewed
                below.
              </p>
            ) : transcript.data?.status === "available" && conversationItems.length > 0 ? (
              <ol className="space-y-3">
                {conversationItems.map((item) =>
                  item.kind === "work" ? (
                    <li key={item.id} className="pl-5">
                      <WorkStep item={item} />
                    </li>
                  ) : (
                    (() => {
                      const isFinal = item.role === "assistant" && item.id === finalMessage?.id;
                      return (
                        <li
                          key={item.id}
                          className={cn(
                            "flex",
                            item.role === "user" ? "justify-end" : "justify-start",
                          )}
                        >
                          <div
                            className={cn(
                              "max-w-[80%]",
                              item.role === "user"
                                ? "rounded-2xl border border-primary/12 bg-accent p-3 text-foreground"
                                : isFinal
                                  ? "w-full"
                                  : "px-1 py-0.5",
                            )}
                          >
                            {isFinal ? (
                              <div className="flex items-center gap-2 rounded-md border border-primary/15 bg-primary/[0.035] px-3 py-2 text-xs text-muted-foreground">
                                <CheckCircle2Icon className="size-3.5 text-primary" />
                                <span className="font-medium text-foreground">Final result</span>
                                <span>Shown in the summary above</span>
                              </div>
                            ) : item.role !== "user" ? (
                              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                                <span>{agentName}</span>
                              </div>
                            ) : null}
                            {!isFinal ? (
                              <ChatMarkdown
                                text={item.text}
                                cwd={markdownCwd}
                                threadRef={threadRef}
                                lineBreaks={item.role === "user"}
                                className={cn(
                                  "break-words",
                                  item.role === "user" ? "text-foreground" : "text-foreground/90",
                                )}
                              />
                            ) : null}
                          </div>
                        </li>
                      );
                    })()
                  ),
                )}
              </ol>
            ) : transcript.data?.status === "available" ? (
              <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                The provider returned no visible messages for this agent.
              </p>
            ) : transcript.data ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-xs leading-5 text-muted-foreground">
                {transcript.data.message}
              </p>
            ) : null}
            {availableTranscript &&
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
                  {transcript.isPending ? "Loading moreºw^~)Þv" : "Load more activity"}
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

        {technicalActivity.length > 0 ? (
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
