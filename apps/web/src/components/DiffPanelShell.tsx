import type { ReactNode } from "react";

import { isElectron } from "~/env";
import { FILES_SKELETON_DELAY_MS, useDeferredPending } from "~/lib/filesDiffsMotion";
import { cn } from "~/lib/utils";

import { Skeleton } from "./ui/skeleton";

export type DiffPanelMode = "inline" | "sheet" | "sidebar" | "embedded";

function getDiffPanelHeaderRowClassName(mode: DiffPanelMode) {
  const shouldUseDragRegion = isElectron && mode !== "sheet" && mode !== "embedded";
  return cn(
    "flex items-center justify-between gap-2 border-primary/10 bg-background px-4",
    shouldUseDragRegion
      ? "drag-region h-[52px] border-b wco:h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]"
      : "surface-subheader",
  );
}

export function DiffPanelShell(props: {
  mode: DiffPanelMode;
  header: ReactNode;
  children: ReactNode;
}) {
  const shouldUseDragRegion = isElectron && props.mode !== "sheet" && props.mode !== "embedded";

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col bg-background",
        props.mode === "inline"
          ? "w-[42vw] min-w-[360px] max-w-[560px] shrink-0 border-l border-primary/10"
          : "w-full",
      )}
    >
      {shouldUseDragRegion ? (
        <div className={getDiffPanelHeaderRowClassName(props.mode)}>{props.header}</div>
      ) : (
        <div className={getDiffPanelHeaderRowClassName(props.mode)} data-surface-subheader>
          {props.header}
        </div>
      )}
      {props.children}
    </div>
  );
}

export function DiffPanelHeaderSkeleton() {
  return (
    <>
      <div className="min-w-0 flex-1">
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>
      <div className="flex shrink-0 gap-1">
        <Skeleton className="size-7 rounded-md" />
        <Skeleton className="size-7 rounded-md" />
      </div>
    </>
  );
}

/**
 * The skeleton is withheld for {@link FILES_SKELETON_DELAY_MS} after this state
 * mounts. A cached diff resolves inside that window and unmounts this component
 * before anything is painted, so a fast scope change never flashes a skeleton.
 * The polite announcement is not delayed — it renders on the first frame.
 */
export function DiffPanelLoadingState(props: { label: string; delayMs?: number }) {
  const skeletonVisible = useDeferredPending(true, props.delayMs ?? FILES_SKELETON_DELAY_MS);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col p-2"
      data-diff-loading-skeleton={skeletonVisible ? "visible" : "deferred"}
    >
      <span className="sr-only" role="status" aria-live="polite">
        {props.label}
      </span>
      {skeletonVisible ? (
        <div
          aria-hidden="true"
          className="files-state-enter flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-primary/10 bg-card/25"
        >
          <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
            <Skeleton className="h-4 w-32 rounded-full" />
            <Skeleton className="ml-auto h-4 w-20 rounded-full" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 px-3 py-4">
            <div className="space-y-2">
              <Skeleton className="h-3 w-full rounded-full" />
              <Skeleton className="h-3 w-full rounded-full" />
              <Skeleton className="h-3 w-10/12 rounded-full" />
              <Skeleton className="h-3 w-11/12 rounded-full" />
              <Skeleton className="h-3 w-9/12 rounded-full" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
