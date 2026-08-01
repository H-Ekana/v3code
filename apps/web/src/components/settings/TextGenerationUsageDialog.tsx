import { useCallback, useEffect, useState } from "react";
import type { EnvironmentId, TextGenerationUsageResult } from "@t3tools/contracts";

import { useAtomCommand } from "../../state/use-atom-command";
import { textGenerationUsageEnvironment } from "../../state/textGenerationUsage";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

const WINDOWS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7Days", label: "Last 7 days" },
  { id: "last30Days", label: "Last 30 days" },
  { id: "lastYear", label: "Last year" },
  { id: "allTime", label: "All time" },
] as const;

type WindowId = (typeof WINDOWS)[number]["id"];

const OPERATION_LABELS: Record<string, string> = {
  generatePromptSuggestion: "Ghost prompts",
  generateCommitMessage: "Commit messages",
  generatePrContent: "PR descriptions",
  generateBranchName: "Branch names",
  generateThreadTitle: "Thread titles",
};

/** "not reported" must never render as 0. */
function formatTokens(value: number | null): string {
  return value === null ? "—" : value.toLocaleString();
}

function formatCost(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "$0.00";
  // Sub-cent totals are the norm for a single call; don't round them to $0.00.
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

export function TextGenerationUsageDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentId: EnvironmentId;
}) {
  const [window, setWindow] = useState<WindowId>("last7Days");
  const [usage, setUsage] = useState<TextGenerationUsageResult | null>(null);
  const [loading, setLoading] = useState(false);

  const getUsage = useAtomCommand(textGenerationUsageEnvironment.getUsage, {
    label: "settings:text-generation-usage",
    reportFailure: false,
  });

  const load = useCallback(
    (next: WindowId) => {
      setLoading(true);
      void getUsage({ environmentId: props.environmentId, input: { window: next } }).then(
        (result) => {
          setLoading(false);
          if (result._tag === "Success") setUsage(result.value);
        },
      );
    },
    [getUsage, props.environmentId],
  );

  useEffect(() => {
    if (props.open) load(window);
  }, [props.open, window, load]);

  const entries = usage?.entries ?? [];

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Text generation usage</DialogTitle>
          <DialogDescription>
            Everything billed to the text generation model — ghost prompts, commit messages, PR
            descriptions, branch names and thread titles. Costs are estimates from a local price
            table, not amounts billed by your provider.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {WINDOWS.map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant={window === option.id ? "default" : "ghost"}
              onClick={() => setWindow(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        {loading && entries.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground text-sm">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground text-sm">
            No text generation in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground text-xs">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Operation</th>
                  <th className="py-1.5 pr-3 font-medium">Model</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Calls</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Input</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Cached</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Output</th>
                  <th className="py-1.5 text-right font-medium">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={`${entry.instanceId}:${entry.model}:${entry.operation}`}
                    className="border-border/50 border-t"
                  >
                    <td className="py-1.5 pr-3">
                      {OPERATION_LABELS[entry.operation] ?? entry.operation}
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{entry.model}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{entry.calls}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {formatTokens(entry.inputTokens)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {formatTokens(entry.cachedInputTokens)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {formatTokens(entry.outputTokens)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatCost(entry.estimatedCostUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-border border-t font-medium">
                  <td className="py-1.5 pr-3" colSpan={6}>
                    Estimated total
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatCost(usage?.totalEstimatedCostUsd ?? null)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {usage?.hasUnreportedTokens ? (
          <p className="text-muted-foreground text-xs">
            A dash means the provider did not report token counts for those calls — not that they
            were free.
          </p>
        ) : null}
        {usage?.hasUnpricedUsage ? (
          <p className="text-muted-foreground text-xs">
            Some models have no price in the local table, so they are excluded from the total.
          </p>
        ) : null}
        {usage?.since ? (
          <p className="text-muted-foreground text-xs">Recording since {usage.since}.</p>
        ) : null}

        <div className="flex justify-end">
          <DialogClose render={<Button variant="ghost">Close</Button>} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
