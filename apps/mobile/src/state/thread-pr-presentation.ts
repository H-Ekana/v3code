import type { VcsStatusResult } from "@t3tools/contracts";
import { resolveChangeRequestPresentation } from "@t3tools/shared/sourceControl";

export type ThreadPr = NonNullable<VcsStatusResult["pr"]>;

/** A row's change-request outcome, reported up for settle classification:
    the state plus when it became terminal (null while open, or unreported). */
export interface ThreadChangeRequestState {
  readonly state: ThreadPr["state"];
  readonly at: string | null;
}

export interface ThreadPrPresentation {
  readonly number: number;
  readonly state: ThreadPr["state"];
  /** ISO 8601 merge/close time; null while open or when unreported. Drives
      settle classification, not presentation. */
  readonly stateChangedAt: string | null;
  readonly url: string;
  /** Compact pull request number label, e.g. "3774". */
  readonly label: string;
  /** Full, provider-aware label for assistive technologies. */
  readonly accessibilityLabel: string;
  readonly textClassName: string;
}

const PR_STATE_TEXT_CLASS: Record<ThreadPr["state"], string> = {
  open: "text-emerald-600 dark:text-emerald-400",
  merged: "text-violet-600 dark:text-violet-400",
  closed: "text-zinc-500 dark:text-zinc-400",
};

export function presentThreadPr(
  pr: ThreadPr,
  provider: VcsStatusResult["sourceControlProvider"] | null | undefined,
): ThreadPrPresentation {
  const presentation = resolveChangeRequestPresentation(provider);
  return {
    number: pr.number,
    state: pr.state,
    stateChangedAt: pr.stateChangedAt ?? null,
    url: pr.url,
    label: String(pr.number),
    accessibilityLabel: `#${pr.number} ${presentation.longName} ${pr.state}`,
    textClassName: PR_STATE_TEXT_CLASS[pr.state],
  };
}
