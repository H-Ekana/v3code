import type { ReactNode } from "react";

import { isElectron } from "~/env";
import { FILES_SKELETON_DELAY_MS, useDeferredPending } from "~/lib/filesDiffsMotion";
import { cn } from "~/lib/utils";

import { Skeleton } from "./ui/skeleton";

export type DiffPanelMode = "inline" | "sheet" | "sidebar" | "embedded";

function getDiffPanelHeaderRowClassName(mode: DiffPanelMode) {
  const shouldUseDragRegion = isElectron && mode !== "sheet" && mode !== "embedded";
  return cn(
    "flex items-center justify-between gap-2 border-primary/10 bg-background",
    mode === "embedded" ? "px-2" : "px-4",
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

function DiffFileHeaderSkeleton({ titleClassName }: { titleClassName: string }) {
  return (
    <div className="flex h-8 items-center gap-2 px-2 pr-3">
      <div className="flex size-5 shrink-0 items-center justify-center">
        <Skeleton className="size-2.5 rounded-[2px]" />
      </div>
      <Skeleton className="size-5 shrink-0 rounded-md" />
      <Skeleton className={cn("h-3 rounded-full", titleClassName)} />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Skeleton className="h-3 w-5 rounded-full" />
        <Skeleton className="h-3 w-5 rounded-full" />
      </div>
    </div>
  );
}

function DiffCodeLineSkeleton({ contentClassName }: { contentClassName: string }) {
  return (
    <div className="flex items-center gap-3">
      <Skeleton className="h-2.5 w-5 shrink-0 rounded-full" />
      <Skeleton className={cn("h-2.5 rounded-full", contentClassName)} />
    </div>
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
      className="min-h-0 flex-1 overflow-hidden bg-background"
      data-diff-loading-skeleton={skeletonVisible ? "visible" : "deferred"}
    >
      <span className="sr-only" role="status" aria-live="polite">
        {props.label}
      </span>
      {skeletonVisible ? (
        <div aria-hidden="true" className="files-state-enter">
          <DiffFileHeaderSkeleton titleClassName="w-1/2 max-w-64" />
          <div className="flex h-6 items-center gap-2 px-2 pr-3">
            <div className="h-px flex-1 bg-border/40" />
            <Skeleton className="h-2.5 w-24 rounded-full" />
            <div className="h-px flex-1 bg-border/40" />
          </div>
          <div className="space-y-2 px-3 py-2">
            <DiffCodeLineSkeleton contentClassName="w-2/3" />
            <DiffCodeLineSkeleton contentClassName="w-4/5" />
            <DiffCodeLineSkeleton contentClassName="w-3/5" />
          </div>
          <DiffFileHeaderSkeleton titleClassName="w-2/5 max-w-52" />
          <DiffFileHeaderSkeleton titleClassName="w-3/5 max-w-72" />
        </div>
      ) : null}
    </div>
  );
}
