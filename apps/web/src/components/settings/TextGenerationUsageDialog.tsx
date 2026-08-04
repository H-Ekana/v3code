import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EnvironmentId,
  TextGenerationUsageEntry,
  TextGenerationUsageResult,
  TextGenerationUsageWindow,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { cn } from "~/lib/utils";
import { useAtomCommand } from "../../state/use-atom-command";
import { textGenerationUsageEnvironment } from "../../state/textGenerationUsage";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "../ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

const WINDOWS: ReadonlyArray<{ id: TextGenerationUsageWindow; label: string }> = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7Days", label: "Last 7 days" },
  { id: "last30Days", label: "Last 30 days" },
  { id: "lastYear", label: "Last year" },
  { id: "allTime", label: "All time" },
];

const OPERATION_LABELS: Record<string, string> = {
  generatePromptSuggestion: "Ghost prompts",
  generateCommitMessage: "Commit messages",
  generatePrContent: "PR descriptions",
  generateBranchName: "Branch names",
  generateThreadTitle: "Thread titles",
};

/**
 * Token counts run to six digits, which is what pushed the old table past the
 * dialog's edge. Compact is the scannable form; the exact count stays reachable
 * as a title so nothing is actually hidden.
 */
const COMPACT_TOKENS = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const EXACT_TOKENS = new Intl.NumberFormat();

/** "not reported" must never render as 0. */
export function formatTokens(value: number | null): string {
  return value === null ? "—" : COMPACT_TOKENS.format(value);
}

function describeTokens(value: number | null): string {
  return value === null
    ? "The provider did not report token counts for these calls"
    : `${EXACT_TOKENS.format(value)} tokens`;
}

/**
 * One precision for the whole column, so decimal points line up under
 * `tabular-nums`. Sub-cent values would round to $0.00 and read as free, so
 * they get an explicit floor marker instead.
 */
export function formatCost(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "$0.00";
  if (value < 0.005) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

/** The headline is a single figure, so it can afford full precision. */
export function formatHeadlineCost(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "$0.00";
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function describeCost(value: number | null): string {
  if (value === null) return "No price for this model in the local table";
  return `$${value.toFixed(6)} estimated`;
}

export function formatSince(day: string): string {
  const parsed = new Date(`${day}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function sumTokens(
  entries: ReadonlyArray<TextGenerationUsageEntry>,
  pick: (entry: TextGenerationUsageEntry) => number | null,
): number | null {
  let total: number | null = null;
  for (const entry of entries) {
    const value = pick(entry);
    if (value !== null) total = (total ?? 0) + value;
  }
  return total;
}

/** The shared ToggleGroup wrapper widens its value to `string`. */
function isWindowId(value: string): value is TextGenerationUsageWindow {
  return WINDOWS.some((option) => option.id === value);
}

function operationLabel(operation: string): string {
  return OPERATION_LABELS[operation] ?? operation;
}

function entryKey(entry: TextGenerationUsageEntry): string {
  return `${entry.instanceId}:${entry.model}:${entry.operation}`;
}

/** Cost is what the dialog is for, so the most expensive row leads. */
export function byCostDescending(a: TextGenerationUsageEntry, b: TextGenerationUsageEntry): number {
  const costA = a.estimatedCostUsd ?? -1;
  const costB = b.estimatedCostUsd ?? -1;
  if (costA !== costB) return costB - costA;
  return b.calls - a.calls;
}

export function TextGenerationUsageDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentId: EnvironmentId;
}) {
  const [range, setRange] = useState<TextGenerationUsageWindow>("last7Days");
  const [usage, setUsage] = useState<TextGenerationUsageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  /** Guards against a slow earlier window landing after a faster later one. */
  const requestTokenRef = useRef(0);

  const getUsage = useAtomCommand(textGenerationUsageEnvironment.getUsage, {
    label: "settings:text-generation-usage",
    reportFailure: false,
  });

  const load = useCallback(
    (next: TextGenerationUsageWindow) => {
      const token = ++requestTokenRef.current;
      setLoading(true);
      setError(null);
      void getUsage({ environmentId: props.environmentId, input: { window: next } }).then(
        (result) => {
          if (token !== requestTokenRef.current) return;
          setLoading(false);
          if (result._tag === "Success") {
            setUsage(result.value);
            return;
          }
          if (isAtomCommandInterrupted(result)) return;
          const failure = squashAtomCommandFailure(result);
          setError(
            failure instanceof Error && failure.message
              ? failure.message
              : "Could not load text generation usage.",
          );
        },
      );
    },
    [getUsage, props.environmentId],
  );

  useEffect(() => {
    if (props.open) load(range);
  }, [props.open, range, load]);

  // The payload carries the window it was computed for, so data from a previous
  // window is never shown under the current window's label.
  const current = usage?.window === range ? usage : null;
  const entries = useMemo(
    () => (current ? [...current.entries].sort(byCostDescending) : []),
    [current],
  );

  const sharedModel = useMemo(() => {
    if (entries.length === 0) return null;
    const first = entries[0]?.model ?? null;
    return entries.every((entry) => entry.model === first) ? first : null;
  }, [entries]);

  const totals = useMemo(
    () => ({
      calls: entries.reduce((sum, entry) => sum + entry.calls, 0),
      failedCalls: entries.reduce((sum, entry) => sum + (entry.calls - entry.succeededCalls), 0),
      inputTokens: sumTokens(entries, (entry) => entry.inputTokens),
      cachedInputTokens: sumTokens(entries, (entry) => entry.cachedInputTokens),
      outputTokens: sumTokens(entries, (entry) => entry.outputTokens),
    }),
    [entries],
  );

  const rangeLabel = WINDOWS.find((option) => option.id === range)?.label ?? "";
  const showModelColumn = sharedModel === null;
  const isRefreshing = loading && current !== null;
  const hasRows = entries.length > 0;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-3xl" initialFocus={titleRef} showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="outline-none" ref={titleRef} tabIndex={-1}>
            Text generation usage
          </DialogTitle>
          <DialogDescription>
            Everything billed to the text generation model — ghost prompts, commit messages, PR
            descriptions, branch names and thread titles. Costs are estimates from a local price
            table, not amounts billed by your provider.
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <ToggleGroup
              aria-label="Reporting period"
              onValueChange={(value) => {
                const next = value[0];
                if (next !== undefined && isWindowId(next)) setRange(next);
              }}
              size="sm"
              value={[range]}
              variant="outline"
            >
              {WINDOWS.map((option) => (
                <ToggleGroupItem key={option.id} value={option.id}>
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {isRefreshing ? (
              <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
                <Spinner className="size-3.5" />
                Updating
              </span>
            ) : null}
          </div>

          {error ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/32 bg-destructive/4 px-3 py-2.5">
              <p className="text-destructive-foreground text-sm">{error}</p>
              <Button onClick={() => load(range)} size="sm" variant="outline">
                Retry
              </Button>
            </div>
          ) : null}

          {loading && current === null && !error ? (
            <p className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
              <Spinner className="size-4" />
              Loading usage…
            </p>
          ) : !hasRows && !error ? (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyTitle>No text generation yet</EmptyTitle>
                <EmptyDescription>
                  Nothing was billed to the text generation model in this period.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : hasRows ? (
            <div
              aria-busy={isRefreshing}
              className={cn(
                "flex flex-col gap-4 transition-opacity duration-150 motion-reduce:transition-none",
                isRefreshing && "opacity-60",
              )}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span
                  className="font-heading font-semibold text-2xl tabular-nums"
                  title={describeCost(current?.totalEstimatedCostUsd ?? null)}
                >
                  {formatHeadlineCost(current?.totalEstimatedCostUsd ?? null)}
                </span>
                <span className="text-muted-foreground text-sm">
                  estimated · {rangeLabel.toLowerCase()}
                </span>
                {sharedModel ? (
                  <span className="text-muted-foreground text-xs">on {sharedModel}</span>
                ) : null}
              </div>

              {/* Six numeric columns do not survive a phone-width bottom sheet. */}
              <ul className="flex flex-col gap-2 sm:hidden">
                {entries.map((entry) => (
                  <li className="rounded-xl border bg-muted/24 p-3" key={entryKey(entry)}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-sm">{operationLabel(entry.operation)}</span>
                      <span
                        className="tabular-nums text-sm"
                        title={describeCost(entry.estimatedCostUsd)}
                      >
                        {formatCost(entry.estimatedCostUsd)}
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground text-xs">
                      {showModelColumn ? `${entry.model} · ` : ""}
                      {entry.calls} {entry.calls === 1 ? "call" : "calls"}
                      {entry.calls > entry.succeededCalls
                        ? ` · ${entry.calls - entry.succeededCalls} failed`
                        : ""}
                    </p>
                    <p className="mt-0.5 text-muted-foreground text-xs tabular-nums">
                      {formatTokens(entry.inputTokens)} in · {formatTokens(entry.cachedInputTokens)}{" "}
                      cached · {formatTokens(entry.outputTokens)} out
                    </p>
                  </li>
                ))}
              </ul>

              {/* Hides the scroll container too, so it adds no gap on mobile. */}
              <div className="hidden sm:block">
                <Table className="text-sm">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-muted-foreground text-xs" scope="col">
                        Operation
                      </TableHead>
                      {showModelColumn ? (
                        <TableHead className="text-muted-foreground text-xs" scope="col">
                          Model
                        </TableHead>
                      ) : null}
                      <TableHead
                        className="text-right text-muted-foreground text-xs"
                        scope="col"
                        title="Total calls, including any that failed"
                      >
                        Calls
                      </TableHead>
                      <TableHead
                        className="text-right text-muted-foreground text-xs"
                        scope="col"
                        title="Uncached input tokens, billed at the full input rate"
                      >
                        Input
                      </TableHead>
                      <TableHead
                        className="text-right text-muted-foreground text-xs"
                        scope="col"
                        title="Cached input tokens, billed at the cheaper cache-read rate"
                      >
                        Cached
                      </TableHead>
                      <TableHead
                        className="text-right text-muted-foreground text-xs"
                        scope="col"
                        title="Generated output tokens"
                      >
                        Output
                      </TableHead>
                      <TableHead className="text-right text-muted-foreground text-xs" scope="col">
                        Est. cost
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => {
                      const failed = entry.calls - entry.succeededCalls;
                      return (
                        <TableRow key={entryKey(entry)}>
                          <TableCell className="font-medium">
                            {operationLabel(entry.operation)}
                          </TableCell>
                          {showModelColumn ? (
                            <TableCell className="text-muted-foreground">{entry.model}</TableCell>
                          ) : null}
                          <TableCell className="text-right tabular-nums">
                            {entry.calls}
                            {failed > 0 ? (
                              <span
                                className="ml-1.5 text-muted-foreground text-xs"
                                title={`${failed} of ${entry.calls} calls produced no usable output`}
                              >
                                {failed} failed
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell
                            className="text-right tabular-nums"
                            title={describeTokens(entry.inputTokens)}
                          >
                            {formatTokens(entry.inputTokens)}
                          </TableCell>
                          <TableCell
                            className="text-right tabular-nums"
                            title={describeTokens(entry.cachedInputTokens)}
                          >
                            {formatTokens(entry.cachedInputTokens)}
                          </TableCell>
                          <TableCell
                            className="text-right tabular-nums"
                            title={describeTokens(entry.outputTokens)}
                          >
                            {formatTokens(entry.outputTokens)}
                          </TableCell>
                          <TableCell
                            className="text-right tabular-nums"
                            title={describeCost(entry.estimatedCostUsd)}
                          >
                            {formatCost(entry.estimatedCostUsd)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="hover:bg-transparent">
                      <TableCell>Estimated total</TableCell>
                      {showModelColumn ? <TableCell /> : null}
                      <TableCell className="text-right tabular-nums">
                        {totals.calls}
                        {totals.failedCalls > 0 ? (
                          <span className="ml-1.5 font-normal text-muted-foreground text-xs">
                            {totals.failedCalls} failed
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell
                        className="text-right tabular-nums"
                        title={describeTokens(totals.inputTokens)}
                      >
                        {formatTokens(totals.inputTokens)}
                      </TableCell>
                      <TableCell
                        className="text-right tabular-nums"
                        title={describeTokens(totals.cachedInputTokens)}
                      >
                        {formatTokens(totals.cachedInputTokens)}
                      </TableCell>
                      <TableCell
                        className="text-right tabular-nums"
                        title={describeTokens(totals.outputTokens)}
                      >
                        {formatTokens(totals.outputTokens)}
                      </TableCell>
                      <TableCell
                        className="text-right tabular-nums"
                        title={describeCost(current?.totalEstimatedCostUsd ?? null)}
                      >
                        {formatCost(current?.totalEstimatedCostUsd ?? null)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </div>
          ) : null}

          {current && hasRows ? (
            <div className="flex flex-col gap-1 text-muted-foreground text-xs">
              {current.hasUnreportedTokens ? (
                <p>
                  A dash means the provider did not report token counts for those calls — not that
                  they were free.
                </p>
              ) : null}
              {current.hasUnpricedUsage ? (
                <p>
                  Some models have no price in the local table, so they are excluded from the total.
                </p>
              ) : null}
              {current.since ? <p>Recording since {formatSince(current.since)}.</p> : null}
            </div>
          ) : null}
        </DialogPanel>

        <DialogFooter variant="bare">
          <Button onClick={() => props.onOpenChange(false)} size="sm" variant="outline">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
