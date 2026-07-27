import type { VcsStatusResult } from "@t3tools/contracts";
import { memo } from "react";

import { formatCompactDiffCount } from "./chat/DiffStatLabel";

type BranchToolbarGitSummaryStatus = Pick<
  VcsStatusResult,
  "workingTree" | "hasUpstream" | "aheadCount" | "behindCount"
>;

export function formatBranchToolbarGitSummary(
  status: BranchToolbarGitSummaryStatus | null,
): string | null {
  if (!status) return null;

  const parts: string[] = [];
  if (status.workingTree.insertions > 0 || status.workingTree.deletions > 0) {
    parts.push(
      `Working tree: ${status.workingTree.insertions} additions, ${status.workingTree.deletions} deletions`,
    );
  }
  if (status.hasUpstream && (status.aheadCount > 0 || status.behindCount > 0)) {
    parts.push(`Upstream: ${status.aheadCount} commits ahead, ${status.behindCount} behind`);
  }

  return parts.length > 0 ? parts.join(". ") : null;
}

export const BranchToolbarGitSummary = memo(function BranchToolbarGitSummary({
  status,
}: {
  status: BranchToolbarGitSummaryStatus | null;
}) {
  const label = formatBranchToolbarGitSummary(status);
  if (!status || !label) return null;

  const hasWorkingTreeDiff = status.workingTree.insertions > 0 || status.workingTree.deletions > 0;
  const hasUpstreamDiff = status.hasUpstream && (status.aheadCount > 0 || status.behindCount > 0);

  return (
    <span
      role="group"
      aria-label={label}
      title={label}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary/[0.055] px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums ring-1 ring-primary/12"
    >
      {hasWorkingTreeDiff ? (
        <span className="inline-flex items-center gap-1" aria-hidden="true">
          <span className="text-foreground/90">
            +{formatCompactDiffCount(status.workingTree.insertions)}
          </span>
          <span className="text-astro-highlight/90">
            −{formatCompactDiffCount(status.workingTree.deletions)}
          </span>
        </span>
      ) : null}
      {hasWorkingTreeDiff && hasUpstreamDiff ? (
        <span className="h-2.5 w-px bg-primary/20" aria-hidden="true" />
      ) : null}
      {hasUpstreamDiff ? (
        <span className="inline-flex items-center gap-1" aria-hidden="true">
          {status.aheadCount > 0 ? (
            <span className="text-foreground/90">↑{status.aheadCount}</span>
          ) : null}
          {status.behindCount > 0 ? (
            <span className="text-primary">↓{status.behindCount}</span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
});
