import * as React from "react";
import type { ContextMenuItem } from "@t3tools/contracts";
import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import {
  getThreadSortTimestamp,
  sortThreads,
  toSortableTimestamp,
  type ThreadSortInput,
} from "../lib/threadSort";
import type { SidebarThreadSummary, Thread } from "../types";
import type { ThreadRouteTarget } from "../threadRoutes";
import { cn } from "../lib/utils";
import { isLatestTurnSettled } from "../session-logic";
import { resolveServerBackedAppStageLabel } from "../branding.logic";
import {
  getStatusPresentation,
  type StatusAxes,
  type StatusIconRole,
} from "../lib/statusPresentation";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";
export const THREAD_JUMP_HINT_SHOW_DELAY_MS = 100;
// Visible sidebar rows are prewarmed into the thread-detail cache so opening a
// nearby thread usually reuses an already-hot subscription.
export const SIDEBAR_THREAD_PREWARM_LIMIT = 10;

type SidebarProject = {
  id: string;
  title: string;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
};

type ScopedSidebarProject = SidebarProject & {
  environmentId: string;
};

type ScopedSidebarThread = ThreadSortInput & {
  environmentId: string;
  projectId: string;
  archivedAt: string | null;
};

type LogicalSidebarProject = SidebarProject & {
  projectKey: string;
  memberProjectRefs: readonly {
    environmentId: string;
    projectId: string;
  }[];
};

export type ThreadTraversalDirection = "previous" | "next";

export async function archiveSelectedThreadEntries<
  TEntry extends { readonly threadKey: string },
  TResult extends { readonly _tag: "Success" | "Failure" },
>(input: {
  entries: readonly TEntry[];
  archive: (entry: TEntry, onArchived: () => void) => Promise<TResult>;
}): Promise<{
  archivedThreadKeys: readonly string[];
  mutationFailure: Extract<TResult, { readonly _tag: "Failure" }> | null;
  followupFailures: readonly Extract<TResult, { readonly _tag: "Failure" }>[];
}> {
  const archivedThreadKeys: string[] = [];
  const followupFailures: Extract<TResult, { readonly _tag: "Failure" }>[] = [];

  for (const entry of input.entries) {
    let didArchive = false;
    const result = await input.archive(entry, () => {
      didArchive = true;
    });
    if (didArchive || result._tag === "Success") {
      archivedThreadKeys.push(entry.threadKey);
    }
    if (result._tag === "Success") continue;
    const failure = result as Extract<TResult, { readonly _tag: "Failure" }>;
    if (didArchive) {
      followupFailures.push(failure);
      continue;
    }
    return { archivedThreadKeys, mutationFailure: failure, followupFailures };
  }

  return { archivedThreadKeys, mutationFailure: null, followupFailures };
}

export function buildMultiSelectThreadContextMenuItems(input: {
  count: number;
  hasRunningThread: boolean;
}): readonly ContextMenuItem<"mark-unread" | "archive" | "delete">[] {
  return [
    { id: "mark-unread", label: `Mark unread (${input.count})` },
    {
      id: "archive",
      label: `Archive (${input.count})`,
      disabled: input.hasRunningThread,
    },
    { id: "delete", label: `Delete (${input.count})`, destructive: true },
  ];
}

export function buildBulkTitleRegenerationContextMenuItem(input: {
  supportedCount: number;
  actionableCount: number;
}): ContextMenuItem<"regenerate-title"> | null {
  if (input.supportedCount === 0) return null;
  if (input.actionableCount === 0) {
    return {
      id: "regenerate-title",
      label: `Regenerating… (${input.supportedCount})`,
      disabled: true,
    };
  }
  return {
    id: "regenerate-title",
    label: `Regenerate titles (${input.actionableCount})`,
  };
}

export interface ThreadStatusPill {
  label:
    | "Working"
    | "Connecting"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
  /**
   * The shared activity/attention/outcome/persistence axes this pill stands
   * for. The domain keeps its own label and hue — "Working" is not "Running",
   * and approval-amber stays distinct from input-indigo — but the icon and
   * motion below are resolved by `lib/statusPresentation` so thread rows,
   * agent cards, and connection indicators cannot drift apart.
   */
  axes: StatusAxes;
  /** Resolved via `getStatusPresentation`; renderers map it to a real glyph so
      status is never carried by colour alone. */
  iconRole: StatusIconRole;
  /** Shared motion recipe class from `styles/motion.css`. */
  motionClass: string;
}

/** Builds the shared half of a pill so every branch below stays consistent. */
function threadStatusPresentation(
  axes: StatusAxes,
): Pick<ThreadStatusPill, "axes" | "iconRole" | "motionClass"> {
  const presentation = getStatusPresentation(axes);
  return {
    axes,
    iconRole: presentation.iconRole,
    motionClass: presentation.motionClass,
  };
}

const THREAD_STATUS_PRIORITY: Record<ThreadStatusPill["label"], number> = {
  "Pending Approval": 5,
  "Awaiting Input": 4,
  Working: 3,
  Connecting: 3,
  "Plan Ready": 2,
  Completed: 1,
};

type ThreadStatusInput = Pick<
  SidebarThreadSummary,
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "interactionMode"
  | "latestTurn"
  | "session"
> & {
  lastVisitedAt?: string | undefined;
};

export interface ThreadJumpHintVisibilityController {
  sync: (shouldShow: boolean) => void;
  dispose: () => void;
}

export function resolveSidebarStageBadgeLabel(input: {
  primaryServerVersion: string | null | undefined;
  fallbackStageLabel: string;
}): string {
  return resolveServerBackedAppStageLabel(input);
}

export function createThreadJumpHintVisibilityController(input: {
  delayMs: number;
  onVisibilityChange: (visible: boolean) => void;
  setTimeoutFn?: typeof globalThis.setTimeout;
  clearTimeoutFn?: typeof globalThis.clearTimeout;
}): ThreadJumpHintVisibilityController {
  const setTimeoutFn = input.setTimeoutFn ?? globalThis.setTimeout;
  const clearTimeoutFn = input.clearTimeoutFn ?? globalThis.clearTimeout;
  let isVisible = false;
  let timeoutId: NodeJS.Timeout | null = null;

  const clearPendingShow = () => {
    if (timeoutId === null) {
      return;
    }
    clearTimeoutFn(timeoutId);
    timeoutId = null;
  };

  return {
    sync: (shouldShow) => {
      if (!shouldShow) {
        clearPendingShow();
        if (isVisible) {
          isVisible = false;
          input.onVisibilityChange(false);
        }
        return;
      }

      if (isVisible || timeoutId !== null) {
        return;
      }

      timeoutId = setTimeoutFn(() => {
        timeoutId = null;
        isVisible = true;
        input.onVisibilityChange(true);
      }, input.delayMs);
    },
    dispose: () => {
      clearPendingShow();
    },
  };
}

export function useThreadJumpHintVisibility(): {
  showThreadJumpHints: boolean;
  updateThreadJumpHintsVisibility: (shouldShow: boolean) => void;
} {
  const [showThreadJumpHints, setShowThreadJumpHints] = React.useState(false);
  const controllerRef = React.useRef<ThreadJumpHintVisibilityController | null>(null);

  React.useEffect(() => {
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        setShowThreadJumpHints(visible);
      },
      setTimeoutFn: window.setTimeout.bind(window),
      clearTimeoutFn: window.clearTimeout.bind(window),
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const updateThreadJumpHintsVisibility = React.useCallback((shouldShow: boolean) => {
    controllerRef.current?.sync(shouldShow);
  }, []);

  return {
    showThreadJumpHints,
    updateThreadJumpHintsVisibility,
  };
}

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return false;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

// A double-click dispatches two `click` events before `dblclick`: the first has
// `detail === 1`, the second `detail === 2`. The second click must not run the
// row's single-click navigation, otherwise double-click-to-rename would also
// navigate. `MouseEvent.detail` is 0 for synthetic/keyboard activations, which
// still count as a normal single activation.
export function isTrailingDoubleClick(detail: number): boolean {
  return detail > 1;
}

export function orderItemsByPreferredIds<TItem, TId>(input: {
  items: readonly TItem[];
  preferredIds: readonly TId[];
  getId: (item: TItem) => TId;
  getPreferenceIds?: (item: TItem) => readonly TId[];
}): TItem[] {
  const { getId, getPreferenceIds, items, preferredIds } = input;
  if (preferredIds.length === 0) {
    return [...items];
  }

  const indexesByPreferenceId = new Map<TId, number[]>();
  for (const [index, item] of items.entries()) {
    const preferenceIds = getPreferenceIds?.(item) ?? [getId(item)];
    for (const preferenceId of new Set(preferenceIds)) {
      const indexes = indexesByPreferenceId.get(preferenceId);
      if (indexes) {
        indexes.push(index);
      } else {
        indexesByPreferenceId.set(preferenceId, [index]);
      }
    }
  }

  const emittedIndexes = new Set<number>();
  const ordered = preferredIds.flatMap((id) => {
    const index = indexesByPreferenceId
      .get(id)
      ?.find((candidate) => !emittedIndexes.has(candidate));
    if (index === undefined) {
      return [];
    }
    emittedIndexes.add(index);
    return [items[index]!];
  });
  const remaining = items.filter((_, index) => !emittedIndexes.has(index));
  return [...ordered, ...remaining];
}

export function getVisibleSidebarThreadIds<TThreadId>(
  renderedProjects: readonly {
    shouldShowThreadPanel?: boolean;
    renderedThreadIds: readonly TThreadId[];
  }[],
): TThreadId[] {
  return renderedProjects.flatMap((renderedProject) =>
    renderedProject.shouldShowThreadPanel === false ? [] : renderedProject.renderedThreadIds,
  );
}

export function getSidebarThreadIdsToPrewarm<TThreadId>(
  visibleThreadIds: readonly TThreadId[],
  limit = SIDEBAR_THREAD_PREWARM_LIMIT,
): TThreadId[] {
  return visibleThreadIds.slice(0, Math.max(0, limit));
}

export function resolveAdjacentThreadId<T>(input: {
  threadIds: readonly T[];
  currentThreadId: T | null;
  direction: ThreadTraversalDirection;
}): T | null {
  const { currentThreadId, direction, threadIds } = input;

  if (threadIds.length === 0) {
    return null;
  }

  if (currentThreadId === null) {
    return direction === "previous" ? (threadIds.at(-1) ?? null) : (threadIds[0] ?? null);
  }

  const currentIndex = threadIds.indexOf(currentThreadId);
  if (currentIndex === -1) {
    return null;
  }

  if (direction === "previous") {
    return currentIndex > 0 ? (threadIds[currentIndex - 1] ?? null) : null;
  }

  return currentIndex < threadIds.length - 1 ? (threadIds[currentIndex + 1] ?? null) : null;
}

export function shouldNavigateAfterProjectRemoval(input: {
  routeTarget: ThreadRouteTarget | null;
  projectThreads: readonly {
    environmentId: string;
    id: string;
  }[];
  projectDraftId: string | null;
}): boolean {
  const { projectDraftId, projectThreads, routeTarget } = input;
  if (routeTarget?.kind === "draft") {
    return projectDraftId === routeTarget.draftId;
  }
  if (routeTarget?.kind !== "server") {
    return false;
  }
  return projectThreads.some(
    (thread) =>
      thread.environmentId === routeTarget.threadRef.environmentId &&
      thread.id === routeTarget.threadRef.threadId,
  );
}

export function isContextMenuPointerDown(input: {
  button: number;
  ctrlKey: boolean;
  isMac: boolean;
}): boolean {
  if (input.button === 2) return true;
  return input.isMac && input.button === 0 && input.ctrlKey;
}

export function resolveThreadRowClassName(input: {
  isActive: boolean;
  isSelected: boolean;
}): string {
  const baseClassName =
    "mx-0.5 h-8 w-[calc(100%-0.25rem)] translate-x-0 cursor-pointer justify-start rounded-md px-2 text-left text-sm select-none transition-[background-color,color,box-shadow] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/70 focus-visible:shadow-[inset_0_0_10px_color-mix(in_srgb,var(--primary)_14%,transparent)] motion-reduce:transition-none";

  if (input.isSelected && input.isActive) {
    return cn(
      baseClassName,
      "bg-[color-mix(in_srgb,var(--sidebar-row-active)_82%,var(--primary))] text-sidebar-foreground font-medium ring-1 ring-inset ring-primary/50 shadow-[inset_0_0_12px_color-mix(in_srgb,var(--primary)_14%,transparent),inset_0_0_4px_color-mix(in_srgb,var(--astro-highlight)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--sidebar-row-active)_78%,var(--primary))] hover:text-sidebar-foreground hover:ring-primary/65 data-[active=true]:bg-[color-mix(in_srgb,var(--sidebar-row-active)_82%,var(--primary))] data-[active=true]:ring-primary/50 data-[active=true]:shadow-[inset_0_0_12px_color-mix(in_srgb,var(--primary)_14%,transparent),inset_0_0_4px_color-mix(in_srgb,var(--astro-highlight)_10%,transparent)] dark:data-[active=true]:bg-[color-mix(in_srgb,var(--sidebar-row-active)_82%,var(--primary))]",
    );
  }

  if (input.isSelected) {
    return cn(
      baseClassName,
      "bg-[color-mix(in_srgb,var(--sidebar-row-selected)_88%,var(--primary))] text-sidebar-foreground ring-1 ring-inset ring-primary/35 shadow-[inset_0_0_10px_color-mix(in_srgb,var(--primary)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--sidebar-row-active)_82%,var(--primary))] hover:text-sidebar-foreground hover:ring-primary/50 hover:shadow-[inset_0_0_10px_color-mix(in_srgb,var(--primary)_12%,transparent),inset_0_0_4px_color-mix(in_srgb,var(--astro-highlight)_8%,transparent)]",
    );
  }

  if (input.isActive) {
    return cn(
      baseClassName,
      "bg-[color-mix(in_srgb,var(--sidebar-row-active)_82%,var(--primary))] text-sidebar-foreground font-medium ring-1 ring-inset ring-primary/50 shadow-[inset_0_0_12px_color-mix(in_srgb,var(--primary)_14%,transparent),inset_0_0_4px_color-mix(in_srgb,var(--astro-highlight)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--sidebar-row-active)_78%,var(--primary))] hover:text-sidebar-foreground hover:ring-primary/65 data-[active=true]:bg-[color-mix(in_srgb,var(--sidebar-row-active)_82%,var(--primary))] data-[active=true]:ring-primary/50 data-[active=true]:shadow-[inset_0_0_12px_color-mix(in_srgb,var(--primary)_14%,transparent),inset_0_0_4px_color-mix(in_srgb,var(--astro-highlight)_10%,transparent)] dark:data-[active=true]:bg-[color-mix(in_srgb,var(--sidebar-row-active)_82%,var(--primary))]",
    );
  }

  return cn(
    baseClassName,
    "text-sidebar-muted-foreground/80 hover:bg-[color-mix(in_srgb,var(--sidebar-row-hover)_92%,var(--primary))] hover:text-sidebar-foreground hover:ring-1 hover:ring-inset hover:ring-primary/15",
  );
}

export function resolveSidebarV2RowSurfaceClassName(input: {
  isActive: boolean;
  isSelected: boolean;
  isUnread: boolean;
  isInFlight: boolean;
  shouldRecede: boolean;
}): string {
  const baseClassName =
    // `scale` is in the transition list for the drag lift: the <li> carries
    // dnd-kit's untransitioned translate (so it tracks the pointer 1:1) while
    // this surface eases its own scale/glow pop in and out. It must be `scale`
    // and not `transform` — Tailwind v4's scale-* utilities compile to the
    // standalone `scale:` property, so a `transform` entry never fires.
    "group/v2-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none transition-[background-color,color,box-shadow,opacity,scale] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/70 motion-reduce:transition-none";

  // While a card is in hand, every row the user is NOT holding recedes, so the
  // lifted card stays unambiguous as rows slide around it. Declared on the
  // surface rather than the <li>, which carries dnd-kit's inline transform
  // transition and would override a transition set here.
  //
  // 70% and no lower: these rows are the drop targets, so they have to stay
  // readable while you pick a slot. On the dark sidebar that still leaves
  // title text around 8:1 against the background.
  const dragRecedeClassName =
    "[[data-sidebar-drag-active]_[data-thread-item]:not([data-dragging])_&]:opacity-70";

  return cn(
    baseClassName,
    dragRecedeClassName,
    input.isActive
      ? "bg-sidebar-row-active text-sidebar-foreground"
      : input.isSelected
        ? "bg-sidebar-row-selected text-sidebar-foreground"
        : input.isUnread
          ? "bg-[color-mix(in_srgb,var(--sidebar-row-active)_84%,var(--primary))] text-sidebar-foreground hover:bg-[color-mix(in_srgb,var(--sidebar-row-active)_78%,var(--primary))]"
          : input.shouldRecede
            ? "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
    input.isUnread &&
      "z-10 ring-1 ring-inset ring-astro-highlight/55 shadow-[0_0_8px_color-mix(in_srgb,var(--primary)_42%,transparent),inset_0_0_12px_color-mix(in_srgb,var(--astro-highlight)_12%,transparent)] hover:ring-astro-highlight/70",
    input.isInFlight && !input.isActive && !input.isSelected && "opacity-70 hover:opacity-100",
  );
}

// ── Sidebar v2 status model ─────────────────────────────────────────
// Five visual states, three colors: color is reserved for "act now"
// (approval), "in motion" (working), and "broken" (failed). Ready is the
// unlabeled resting state — the agent stopped and is waiting on the user,
// whether it finished, asked a question, or proposed a plan.
// Unread completion is tracked separately: it describes whether a ready
// thread needs attention, not what the thread is currently doing.
export type SidebarV2Status = "approval" | "input" | "working" | "agents" | "failed" | "ready";

type SidebarV2StatusInput = Pick<
  SidebarThreadSummary,
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "session"
  | "activeAgentCount"
  | "activeBackgroundTaskCount"
  | "agentsLastActivityAt"
>;

/**
 * How long a roster may go quiet before its agents stop counting as live.
 *
 * A server that dies mid-run never writes a terminal snapshot, so its agents
 * replay as `running` forever (see scripts/fix-stuck-agent-cards.mjs) — without
 * a cutoff a crashed thread would advertise "3 agents" permanently and could
 * never show Done. 30 minutes matches ProviderSessionReaper's own idle
 * threshold: past that the session is reaped anyway, so a roster still claiming
 * to be busy is lying.
 */
export const SIDEBAR_AGENTS_STALE_AFTER_MS = 30 * 60_000;

function hasLiveSubagents(thread: SidebarV2StatusInput, nowMs: number): boolean {
  // Background tasks (shell watchers, monitors) keep the thread "agents"-live
  // too: the main turn is done but the thread is still producing. The badge
  // label distinguishes the two — the liveness rule does not need to.
  if (thread.activeAgentCount + thread.activeBackgroundTaskCount <= 0) {
    return false;
  }
  // A roster with active rows but no timestamp cannot be aged out, so it is
  // treated as stale rather than risking a badge that never clears.
  if (thread.agentsLastActivityAt === null) {
    return false;
  }
  const lastActivityMs = Date.parse(thread.agentsLastActivityAt);
  if (Number.isNaN(lastActivityMs)) {
    return false;
  }
  return nowMs - lastActivityMs < SIDEBAR_AGENTS_STALE_AFTER_MS;
}

export function resolveSidebarV2Status(
  thread: SidebarV2StatusInput,
  nowMs: number = Date.now(),
): SidebarV2Status {
  if (thread.hasPendingApprovals) {
    return "approval";
  }
  if (thread.hasPendingUserInput) {
    return "input";
  }
  if (thread.session?.status === "running" || thread.session?.status === "starting") {
    return "working";
  }
  if (thread.session?.status === "error") {
    return "failed";
  }
  // Ranked below the session states because it only describes the gap they
  // leave: the session drops to "ready" the instant the main turn completes,
  // with no regard for backgrounded subagents, so a thread can be settled-
  // looking and still producing. Sitting above "ready" is also what keeps the
  // Done checkmark off a thread whose subagents have not reported back.
  if (hasLiveSubagents(thread, nowMs)) {
    return "agents";
  }
  return "ready";
}

/** NaN-safe Date.parse for sort comparators: a malformed timestamp must not
    poison the whole ordering, so it sinks to the epoch instead. */
export function parseTimestampMs(isoDate: string): number {
  const parsed = Date.parse(isoDate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** First VALID timestamp wins: `a ?? b` falls through on null, but a present-
    yet-malformed string must also fall through to the next candidate rather
    than sink the row to the epoch. */
export function firstValidTimestampMs(
  ...candidates: ReadonlyArray<string | null | undefined>
): number {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

/** String twin of firstValidTimestampMs for callers that need the ISO string
    (display labels, tick anchors) rather than epoch ms. */
export function firstValidTimestamp(
  ...candidates: ReadonlyArray<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    if (!Number.isNaN(Date.parse(candidate))) return candidate;
  }
  return null;
}

// v2 sort: static creation order, newest thread on top. Activity NEVER
// reorders the list — a row holds its position from open until settled, so
// the screen only moves at lifecycle transitions. Status (including pending
// approval) is carried by each card's edge strip, not by position.
export function sortThreadsForSidebarV2<
  T extends { readonly id: string; readonly createdAt: string },
>(threads: readonly T[]): T[] {
  return [...threads].toSorted(
    (left, right) =>
      parseTimestampMs(right.createdAt) - parseTimestampMs(left.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

/**
 * Overlays the user's hand-arranged order on top of the natural v2 order.
 *
 * Threads the user never dragged keep their natural NEIGHBOURS rather than
 * being flushed to one end of the list (which is what a plain
 * `orderItemsByPreferredIds` would do). Each unarranged thread is anchored
 * behind the nearest arranged thread above it in the natural order, so a
 * brand-new thread — natural position 0, nothing arranged above it — still
 * lands on top even after everything below it has been hand-arranged.
 */
export function applyManualThreadOrder<TItem>(input: {
  items: readonly TItem[];
  manualOrder: readonly string[];
  getKey: (item: TItem) => string;
}): TItem[] {
  const { getKey, items, manualOrder } = input;
  if (manualOrder.length === 0 || items.length === 0) {
    return [...items];
  }
  const rankByKey = new Map(manualOrder.map((key, index) => [key, index] as const));

  // Anchor pass: walk the natural order, collecting arranged threads and
  // hanging each unarranged thread off the last arranged one seen above it
  // (anchor `null` means "above every arranged thread").
  const arranged: { key: string; item: TItem }[] = [];
  const followersByAnchor = new Map<string | null, TItem[]>();
  let anchor: string | null = null;
  for (const item of items) {
    const key = getKey(item);
    if (rankByKey.has(key)) {
      arranged.push({ key, item });
      anchor = key;
      continue;
    }
    const followers = followersByAnchor.get(anchor);
    if (followers) {
      followers.push(item);
    } else {
      followersByAnchor.set(anchor, [item]);
    }
  }
  if (arranged.length === 0) {
    return [...items];
  }

  arranged.sort((left, right) => rankByKey.get(left.key)! - rankByKey.get(right.key)!);
  const ordered: TItem[] = [...(followersByAnchor.get(null) ?? [])];
  for (const entry of arranged) {
    ordered.push(entry.item);
    const followers = followersByAnchor.get(entry.key);
    if (followers) {
      ordered.push(...followers);
    }
  }
  return ordered;
}

/**
 * Moves one thread key to the slot currently held by another, returning the
 * full next order. Both keys must already be in `orderedKeys` (the sidebar
 * always hands in the rendered active order, so they are).
 */
export function moveThreadInManualOrder(
  orderedKeys: readonly string[],
  draggedKey: string,
  targetKey: string,
): string[] {
  if (draggedKey === targetKey) {
    return [...orderedKeys];
  }
  const fromIndex = orderedKeys.indexOf(draggedKey);
  const toIndex = orderedKeys.indexOf(targetKey);
  if (fromIndex < 0 || toIndex < 0) {
    return [...orderedKeys];
  }
  const next = [...orderedKeys];
  next.splice(toIndex, 0, next.splice(fromIndex, 1)[0]!);
  return next;
}

/** Preserve click activation until intentional pointer travel starts a reorder. */
export const SIDEBAR_THREAD_DRAG_ACTIVATION_CONSTRAINT = { distance: 6 } as const;

/**
 * Search the already-ordered sidebar thread collection by title only.
 * Keeping the input order means lifecycle ordering (active, snoozed, settled)
 * remains stable while the user narrows the list.
 */
export function searchSidebarThreadsByTitle<T extends { readonly title: string }>(
  threads: readonly T[],
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return [];
  return threads.filter((thread) => thread.title.toLowerCase().includes(normalizedQuery));
}

type SettledTimestampInput = Pick<
  SidebarThreadSummary,
  "settledAt" | "latestUserMessageAt" | "latestTurn" | "updatedAt"
>;

/** The timestamp a settled row sorts and labels by: settledAt when stamped
    (explicit settles), otherwise last activity — the same candidates
    threadLastActivityAt feeds the auto-settle window (user message plus all
    latestTurn stamps), so a thread whose last activity was a turn completion
    doesn't sort by an older message time. updatedAt is the final net. */
export function resolveSettledTimestamp(thread: SettledTimestampInput): string | null {
  const settledAt = firstValidTimestamp(thread.settledAt);
  if (settledAt !== null) return settledAt;
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const candidate of [
    thread.latestUserMessageAt,
    thread.latestTurn?.requestedAt,
    thread.latestTurn?.startedAt,
    thread.latestTurn?.completedAt,
  ]) {
    if (candidate == null) continue;
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed) && parsed > latestMs) {
      latest = candidate;
      latestMs = parsed;
    }
  }
  return latest ?? firstValidTimestamp(thread.updatedAt);
}

// Settled rows are history, so they order by when the work ENDED, not when
// the thread was created or last touched.
export function sortSettledThreadsForSidebarV2<
  T extends SettledTimestampInput & { readonly id: string },
>(threads: readonly T[]): T[] {
  const timestampMs = (thread: T) => {
    const timestamp = resolveSettledTimestamp(thread);
    return timestamp === null ? 0 : Date.parse(timestamp);
  };
  return [...threads].toSorted(
    (left, right) => timestampMs(right) - timestampMs(left) || left.id.localeCompare(right.id),
  );
}

/** The timestamp a working thread's elapsed label counts from: the running
    turn's start (request time until adoption), falling back to the session's
    last transition when the turn projection lags behind. Malformed
    timestamps fall through to the next candidate, not just missing ones. */
export function resolveWorkingStartedAt(
  thread: Pick<SidebarThreadSummary, "latestTurn" | "session">,
): string | null {
  const turn = thread.latestTurn;
  if (turn && turn.completedAt === null) {
    return firstValidTimestamp(turn.startedAt, turn.requestedAt, thread.session?.updatedAt);
  }
  return firstValidTimestamp(thread.session?.updatedAt);
}

export function formatWorkingDurationLabel(elapsedMs: number): string {
  const seconds = Number.isFinite(elapsedMs) ? Math.max(0, Math.floor(elapsedMs / 1000)) : 0;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function resolveThreadStatusPill(input: {
  thread: ThreadStatusInput;
}): ThreadStatusPill | null {
  const { thread } = input;

  if (thread.hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
      ...threadStatusPresentation({
        activity: "waiting",
        attention: "approval-required",
        outcome: "neutral",
        persistence: "active",
      }),
    };
  }

  if (thread.hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      // Indigo, not the shared waiting-amber: this sidebar, v2, and the mobile
      // widgets all reserve amber for "approve something" and indigo for
      // "answer something". The shared axes still classify both as `waiting`,
      // so the icon and motion match.
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
      ...threadStatusPresentation({
        activity: "waiting",
        attention: "input-required",
        outcome: "neutral",
        persistence: "active",
      }),
    };
  }

  if (thread.session?.status === "running") {
    return {
      label: "Working",
      // Retheme (plan item 3): the old cyan/blue `Working` treatment now uses
      // the shared violet running recipe. Blue is reserved for genuinely
      // informational states. The label and the dashed-ring icon carry the
      // meaning, so this reads correctly with colour ignored.
      colorClass: "text-primary",
      dotClass: "bg-primary",
      pulse: true,
      ...threadStatusPresentation({
        activity: "running",
        attention: "none",
        outcome: "neutral",
        persistence: "active",
      }),
    };
  }

  if (thread.session?.status === "starting") {
    return {
      label: "Connecting",
      // Same violet running recipe: connecting is ongoing activity, not
      // information. Only the label distinguishes it from Working.
      colorClass: "text-primary/85",
      dotClass: "bg-primary/85",
      pulse: true,
      ...threadStatusPresentation({
        activity: "running",
        attention: "none",
        outcome: "neutral",
        persistence: "active",
      }),
    };
  }

  const hasPlanReadyPrompt =
    !thread.hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    thread.hasActionableProposedPlan;
  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      dotClass: "bg-violet-500 dark:bg-violet-300/90",
      pulse: false,
      ...threadStatusPresentation({
        activity: "waiting",
        attention: "input-required",
        outcome: "neutral",
        persistence: "active",
      }),
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
      // `unseen-result` is what earns `motion-completion`. A thread the user
      // has already opened never reaches this branch, so restored history
      // cannot replay the arrival.
      ...threadStatusPresentation({
        activity: "complete",
        attention: "unseen-result",
        outcome: "success",
        persistence: "active",
      }),
    };
  }

  return null;
}

export function resolveProjectStatusIndicator(
  statuses: ReadonlyArray<ThreadStatusPill | null>,
): ThreadStatusPill | null {
  let highestPriorityStatus: ThreadStatusPill | null = null;

  for (const status of statuses) {
    if (status === null) continue;
    if (
      highestPriorityStatus === null ||
      THREAD_STATUS_PRIORITY[status.label] > THREAD_STATUS_PRIORITY[highestPriorityStatus.label]
    ) {
      highestPriorityStatus = status;
    }
  }

  return highestPriorityStatus;
}

export function getVisibleThreadsForProject<T extends Pick<Thread, "id">>(input: {
  threads: readonly T[];
  activeThreadId: T["id"] | undefined;
  isThreadListExpanded: boolean;
  previewLimit: number;
}): {
  hasHiddenThreads: boolean;
  visibleThreads: T[];
  hiddenThreads: T[];
} {
  const { activeThreadId, isThreadListExpanded, previewLimit, threads } = input;
  const hasHiddenThreads = threads.length > previewLimit;

  if (!hasHiddenThreads || isThreadListExpanded) {
    return {
      hasHiddenThreads,
      hiddenThreads: [],
      visibleThreads: [...threads],
    };
  }

  const previewThreads = threads.slice(0, previewLimit);
  if (!activeThreadId || previewThreads.some((thread) => thread.id === activeThreadId)) {
    return {
      hasHiddenThreads: true,
      hiddenThreads: threads.slice(previewLimit),
      visibleThreads: previewThreads,
    };
  }

  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  if (!activeThread) {
    return {
      hasHiddenThreads: true,
      hiddenThreads: threads.slice(previewLimit),
      visibleThreads: previewThreads,
    };
  }

  const visibleThreadIds = new Set([...previewThreads, activeThread].map((thread) => thread.id));

  return {
    hasHiddenThreads: true,
    hiddenThreads: threads.filter((thread) => !visibleThreadIds.has(thread.id)),
    visibleThreads: threads.filter((thread) => visibleThreadIds.has(thread.id)),
  };
}

export function getFallbackThreadIdAfterDelete<
  T extends Pick<Thread, "id" | "projectId" | "createdAt" | "updatedAt"> & ThreadSortInput,
>(input: {
  threads: readonly T[];
  deletedThreadId: T["id"];
  sortOrder: SidebarThreadSortOrder;
  deletedThreadIds?: ReadonlySet<T["id"]>;
}): T["id"] | null {
  const { deletedThreadId, deletedThreadIds, sortOrder, threads } = input;
  const deletedThread = threads.find((thread) => thread.id === deletedThreadId);
  if (!deletedThread) {
    return null;
  }

  return (
    sortThreads(
      threads.filter(
        (thread) =>
          thread.projectId === deletedThread.projectId &&
          thread.id !== deletedThreadId &&
          !deletedThreadIds?.has(thread.id),
      ),
      sortOrder,
    )[0]?.id ?? null
  );
}
export function getProjectSortTimestamp(
  project: SidebarProject,
  projectThreads: readonly ThreadSortInput[],
  sortOrder: Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (projectThreads.length > 0) {
    return projectThreads.reduce(
      (latest, thread) => Math.max(latest, getThreadSortTimestamp(thread, sortOrder)),
      Number.NEGATIVE_INFINITY,
    );
  }

  if (sortOrder === "created_at") {
    return toSortableTimestamp(project.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return toSortableTimestamp(project.updatedAt ?? project.createdAt) ?? Number.NEGATIVE_INFINITY;
}

function sortProjectsByActivity<TProject extends SidebarProject>(
  projects: readonly TProject[],
  sortOrder: SidebarProjectSortOrder,
  getProjectThreads: (project: TProject) => readonly ThreadSortInput[],
  compareTies: (left: TProject, right: TProject) => number,
): TProject[] {
  if (sortOrder === "manual") {
    return [...projects];
  }

  return [...projects].toSorted((left, right) => {
    const rightTimestamp = getProjectSortTimestamp(right, getProjectThreads(right), sortOrder);
    const leftTimestamp = getProjectSortTimestamp(left, getProjectThreads(left), sortOrder);
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    return byTimestamp || compareTies(left, right);
  });
}

export function sortProjectsForSidebar<
  TProject extends SidebarProject,
  TThread extends Pick<Thread, "projectId" | "createdAt" | "updatedAt"> & ThreadSortInput,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  const threadsByProjectId = new Map<string, TThread[]>();
  for (const thread of threads) {
    const existing = threadsByProjectId.get(thread.projectId) ?? [];
    existing.push(thread);
    threadsByProjectId.set(thread.projectId, existing);
  }

  return sortProjectsByActivity(
    projects,
    sortOrder,
    (project) => threadsByProjectId.get(project.id) ?? [],
    (left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
  );
}

export function sortLogicalProjectsForSidebar<
  TProject extends LogicalSidebarProject,
  TThread extends ScopedSidebarThread,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  const groupKeyByProjectRef = new Map(
    projects.flatMap((project) =>
      project.memberProjectRefs.map(
        (projectRef) =>
          [`${projectRef.environmentId}\0${projectRef.projectId}`, project.projectKey] as const,
      ),
    ),
  );
  const threadsByProjectKey = new Map<string, TThread[]>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const projectKey = groupKeyByProjectRef.get(`${thread.environmentId}\0${thread.projectId}`);
    if (!projectKey) continue;
    const existing = threadsByProjectKey.get(projectKey);
    if (existing) {
      existing.push(thread);
    } else {
      threadsByProjectKey.set(projectKey, [thread]);
    }
  }

  return sortProjectsByActivity(
    projects,
    sortOrder,
    (project) => threadsByProjectKey.get(project.projectKey) ?? [],
    (left, right) =>
      left.title.localeCompare(right.title) || left.projectKey.localeCompare(right.projectKey),
  );
}

/**
 * Sorts the cross-environment project collection used by landing surfaces.
 * Project ids are only unique within an environment, and archived threads
 * must not make a project appear recently active.
 */
export function sortScopedProjectsForSidebar<
  TProject extends ScopedSidebarProject,
  TThread extends ScopedSidebarThread,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  const scopedKey = (environmentId: string, projectId: string) =>
    `${environmentId}\u0000${projectId}`;
  const threadsByProject = new Map<string, TThread[]>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) {
      continue;
    }
    const key = scopedKey(thread.environmentId, thread.projectId);
    const existing = threadsByProject.get(key) ?? [];
    existing.push(thread);
    threadsByProject.set(key, existing);
  }

  return sortProjectsByActivity(
    projects,
    sortOrder,
    (project) => threadsByProject.get(scopedKey(project.environmentId, project.id)) ?? [],
    (left, right) =>
      left.title.localeCompare(right.title) ||
      left.environmentId.localeCompare(right.environmentId) ||
      left.id.localeCompare(right.id),
  );
}

// ── Thread settlement acknowledgment (plan item 11) ──────────────────
//
// The acknowledgment is driven by an explicit command reducer and is
// deliberately NOT derived from `thread.settledAt` or from a row's settled
// partition. Anything derived from state replays: a remount, a reorder, a
// project-scope flip, a snoozed thread waking into the settled tail, or simply
// opening an already-settled thread would all re-fire the accent, because from
// the row's point of view those are indistinguishable from "just settled".
//
// A row can therefore only be acknowledged if a `beginThreadSettle` for that
// exact key preceded the resolve. Automatic settlement never calls it, so it
// can never light up.

export type ThreadSettleSource = "single" | "bulk" | "automatic";

export type ThreadSettlePhase = "idle" | "pending" | "acknowledged" | "failed";

export interface ThreadSettleAcknowledgementState {
  /** Keys whose settle command is in flight, with the source that started it. */
  readonly pending: ReadonlyMap<string, ThreadSettleSource>;
  /** Keys that earned the Level 3 accent and have not yet been cleared. */
  readonly acknowledged: ReadonlySet<string>;
  /**
   * Acknowledged keys still HELD in their pre-settle ACTIVE slot. A subset of
   * `acknowledged`: the store may already classify the thread as settled, but
   * the grouping layer keeps a held row where it is so the ring laps and the
   * row edge lights IN PLACE. The FLIP relocation into the settled shelf only
   * plays once the key leaves `held` (see `releaseThreadSettleHold`), which is
   * what stops the slide from starting before the ring completes its lap.
   */
  readonly held: ReadonlySet<string>;
  /** Keys whose settle failed: semantic error emphasis, never an accent. */
  readonly failed: ReadonlySet<string>;
}

export const EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT: ThreadSettleAcknowledgementState = {
  pending: new Map(),
  acknowledged: new Set(),
  held: new Set(),
  failed: new Set(),
};

/** Ring travel around the settle control. Level 3 band is 240–300ms. */
export const THREAD_SETTLE_ACK_DURATION_MS = 280;
/** All-round row edge illumination as the row settles. Part of the same Level 3
    acknowledgment as the ring, so it spends the accent's 240–300ms band.
    Mirrors --threads-settle-row-edge in agents-threads.css. */
export const THREAD_SETTLE_ROW_EDGE_MS = 260;
/** The FLIP slide that carries a just-settled row from its active card slot
    into the settled shelf. Level 3 band (240–300ms); driven as a WAAPI
    transform in SidebarV2 so it re-runs per settle and never freezes state. */
export const THREAD_SETTLE_RELOCATE_MS = 280;
/**
 * How long a just-acknowledged single settle is HELD in its pre-settle ACTIVE
 * slot before the row is allowed to regroup into the settled shelf. The ring
 * laps and the row edge lights IN PLACE during this window, so the slide can
 * never begin before the ring (THREAD_SETTLE_ACK_DURATION_MS, 280ms) has
 * completed its full lap — with a little headroom over the row edge
 * (THREAD_SETTLE_ROW_EDGE_MS, 260ms) so the whole in-place accent reads before
 * the row leaves. JS-only: it drives a setTimeout plus the active/settled
 * partition, not a CSS animation, so unlike the durations above it has no
 * `--token` mirror to keep in step. */
export const THREAD_SETTLE_HOLD_MS = 300;
/** How long a failed settle keeps its destructive emphasis on the control. */
export const THREAD_SETTLE_FAILED_MS = 2_000;

function withoutKey<T>(source: ReadonlySet<T>, key: T): ReadonlySet<T> {
  if (!source.has(key)) return source;
  const next = new Set(source);
  next.delete(key);
  return next;
}

/**
 * Records the press. The control shows a pending owner immediately; nothing
 * celebratory happens yet, because the settlement has not succeeded.
 */
export function beginThreadSettle(
  state: ThreadSettleAcknowledgementState,
  input: { threadKey: string; source: ThreadSettleSource },
): ThreadSettleAcknowledgementState {
  const pending = new Map(state.pending);
  pending.set(input.threadKey, input.source);
  return {
    pending,
    // A retry clears the previous outcome so a stale accent, hold, or error
    // mark cannot sit under a fresh attempt.
    acknowledged: withoutKey(state.acknowledged, input.threadKey),
    held: withoutKey(state.held, input.threadKey),
    failed: withoutKey(state.failed, input.threadKey),
  };
}

/**
 * Resolves an in-flight settle.
 *
 * Only a `single`-source success earns the acknowledgment. `bulk` and
 * `automatic` successes clear quietly — the shared completion summary is the
 * settled shelf's own count, not a per-row flourish. A resolve for a key that
 * was never begun is ignored entirely, which is what makes remount, reorder,
 * and automatic settlement inert.
 */
export function resolveThreadSettle(
  state: ThreadSettleAcknowledgementState,
  input: { threadKey: string; outcome: "success" | "failure" },
): ThreadSettleAcknowledgementState {
  const source = state.pending.get(input.threadKey);
  if (source === undefined) {
    return state;
  }
  const pending = new Map(state.pending);
  pending.delete(input.threadKey);

  if (input.outcome === "failure") {
    const failed = new Set(state.failed);
    failed.add(input.threadKey);
    return { pending, acknowledged: state.acknowledged, held: state.held, failed };
  }

  if (source !== "single") {
    return { pending, acknowledged: state.acknowledged, held: state.held, failed: state.failed };
  }

  const acknowledged = new Set(state.acknowledged);
  acknowledged.add(input.threadKey);
  // The row is held in its active slot for the same success: the ring must lap
  // in place before the grouping layer lets it relocate into the settled shelf.
  // Only a `single` source is ever held — bulk and automatic settles returned
  // above and so never light up or hold.
  const held = new Set(state.held);
  held.add(input.threadKey);
  return { pending, acknowledged, held, failed: state.failed };
}

/**
 * Ends the hold-in-place window for one row. The key stays `acknowledged` — the
 * ring and row edge already played in place, and the accent rides the slide out
 * — but is no longer `held`, so the active/settled partition may finally regroup
 * it into the settled shelf. That regroup is the commit on which the existing
 * FLIP measures the delta and plays the slide. A key that was never held (or
 * already released) is returned unchanged so the caller's timer is inert.
 */
export function releaseThreadSettleHold(
  state: ThreadSettleAcknowledgementState,
  input: { threadKey: string },
): ThreadSettleAcknowledgementState {
  const held = withoutKey(state.held, input.threadKey);
  if (held === state.held) return state;
  return { pending: state.pending, acknowledged: state.acknowledged, held, failed: state.failed };
}

/** Drops a one-shot mark once its animation window has elapsed. Clearing the
    acknowledgment also drops any lingering hold so a torn-down accent can never
    strand a row out of its settled shelf. */
export function clearThreadSettleMark(
  state: ThreadSettleAcknowledgementState,
  input: { threadKey: string; mark: "acknowledged" | "failed" },
): ThreadSettleAcknowledgementState {
  const source = input.mark === "acknowledged" ? state.acknowledged : state.failed;
  const next = withoutKey(source, input.threadKey);
  if (next === source) return state;
  return input.mark === "acknowledged"
    ? {
        pending: state.pending,
        acknowledged: next,
        held: withoutKey(state.held, input.threadKey),
        failed: state.failed,
      }
    : { pending: state.pending, acknowledged: state.acknowledged, held: state.held, failed: next };
}

export function threadSettlePhase(
  state: ThreadSettleAcknowledgementState,
  threadKey: string,
): ThreadSettlePhase {
  if (state.pending.has(threadKey)) return "pending";
  if (state.acknowledged.has(threadKey)) return "acknowledged";
  if (state.failed.has(threadKey)) return "failed";
  return "idle";
}
