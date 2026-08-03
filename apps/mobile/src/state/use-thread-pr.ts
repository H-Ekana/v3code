import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import { useEnvironmentQuery } from "./query";
import { presentThreadPr, type ThreadPrPresentation } from "./thread-pr-presentation";
import { vcsEnvironment } from "./vcs";

export {
  presentThreadPr,
  type ThreadPr,
  type ThreadPrPresentation,
} from "./thread-pr-presentation";

/**
 * Live PR status for a thread's branch. Subscriptions are deduplicated per
 * (environmentId, cwd) by the atom family, so many rows on the same worktree
 * or project root share one stream — and virtualization means only visible
 * rows subscribe at all.
 */
export function useThreadPr(
  thread: EnvironmentThreadShell,
  projectCwd: string | null,
): ThreadPrPresentation | null {
  const cwd = thread.worktreePath ?? projectCwd;
  const gitStatus = useEnvironmentQuery(
    thread.branch !== null && cwd !== null
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: { cwd },
        })
      : null,
  );

  const status = gitStatus.data;
  if (status === null || thread.branch === null || status.refName !== thread.branch) {
    return null;
  }
  if (!status.pr) {
    return null;
  }
  // Branch-name equality is not identity (mirrors web's resolveThreadPr): a
  // long-lived branch keeps matching the change request it was promoted
  // through, so a thread opened after that outcome must not inherit it.
  if (!changeRequestOutlivedThreadStart(status.pr.stateChangedAt ?? null, thread.createdAt)) {
    return null;
  }
  return presentThreadPr(status.pr, status.sourceControlProvider);
}

function changeRequestOutlivedThreadStart(
  stateChangedAt: string | null,
  threadCreatedAt: string | null,
): boolean {
  // Open change requests carry no outcome time and always belong to current
  // work on the branch; unknown timestamps keep the previous behaviour.
  if (stateChangedAt === null || threadCreatedAt === null) return true;
  const stateChangedAtMs = Date.parse(stateChangedAt);
  const threadCreatedAtMs = Date.parse(threadCreatedAt);
  if (Number.isNaN(stateChangedAtMs) || Number.isNaN(threadCreatedAtMs)) return true;
  return stateChangedAtMs > threadCreatedAtMs;
}
