import * as Equal from "effect/Equal";
import {
  formatDuration,
  workEntryIndicatesToolFailure,
  workEntryIndicatesToolNeutralStatus,
  workEntryIndicatesToolSuccess,
  workLogEntryIsToolLike,
  type TimelineEntry,
  type WorkLogEntry,
} from "../../session-logic";
import { type ChatMessage, type ProposedPlan, type TurnDiffSummary } from "../../types";
import { type MessageId, type OrchestrationLatestTurn, type TurnId } from "@t3tools/contracts";

export const MAX_VISIBLE_WORK_LOG_ENTRIES = 1;
export const TIMELINE_MINIMAP_ITEM_SPACING = 8;
export const TIMELINE_MINIMAP_MIN_ITEMS = 2;
export const TIMELINE_MINIMAP_MAX_HEIGHT_CSS = "calc(100vh - 18rem)";
export const TIMELINE_CONTENT_MAX_WIDTH = 768;
export const TIMELINE_MINIMAP_PERSISTENT_GUTTER = 48;

export interface TimelineEndState {
  readonly isAtEnd?: boolean;
  readonly isNearEnd?: boolean;
}

/**
 * The generous signal: `isNearEnd` is a half-viewport threshold. It drives
 * live-follow and the new-text indicator, where "close enough to the bottom"
 * is the right question.
 */
export function resolveTimelineIsAtEnd(state: TimelineEndState | undefined): boolean | undefined {
  return state?.isNearEnd ?? state?.isAtEnd;
}

/**
 * The strict signal: was the reader actually pinned to the live edge? This is
 * the one the send decision must use. Half a viewport of slack is far too much
 * latitude for "sending is allowed to move the viewport" — it makes a send from
 * a third of the way up the last screen behave like a send from the bottom.
 */
export function resolveTimelineIsStrictlyAtEnd(
  state: TimelineEndState | undefined,
): boolean | undefined {
  return state?.isAtEnd;
}

export function resolveTimelineMinimapHeightStyle(itemCount: number): string {
  const naturalHeight = Math.max(1, (itemCount - 1) * TIMELINE_MINIMAP_ITEM_SPACING);
  return `min(${naturalHeight}px, ${TIMELINE_MINIMAP_MAX_HEIGHT_CSS})`;
}

export function resolveTimelineMinimapTopPercent(index: number, itemCount: number): number {
  if (itemCount <= 1) {
    return 0;
  }
  return (Math.max(0, Math.min(index, itemCount - 1)) / (itemCount - 1)) * 100;
}

export function resolveTimelineMinimapIndexFromPointer(input: {
  readonly itemCount: number;
  readonly railTop: number;
  readonly railHeight: number;
  readonly pointerY: number;
}): number | null {
  if (input.itemCount <= 0 || input.railHeight <= 0) {
    return null;
  }
  if (input.itemCount === 1) {
    return 0;
  }

  const progress = Math.max(0, Math.min(1, (input.pointerY - input.railTop) / input.railHeight));
  return Math.max(0, Math.min(input.itemCount - 1, Math.round(progress * (input.itemCount - 1))));
}

export function resolveTimelineMinimapHasPersistentGutter(viewportWidth: number): boolean {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return false;
  }

  const contentWidth = Math.min(viewportWidth, TIMELINE_CONTENT_MAX_WIDTH);
  const sideGutter = Math.max(0, (viewportWidth - contentWidth) / 2);
  return sideGutter >= TIMELINE_MINIMAP_PERSISTENT_GUTTER;
}

export const TIMELINE_MINIMAP_HIT_STRIP_LEFT = 12;
export const TIMELINE_MINIMAP_HIT_STRIP_MAX_WIDTH = 40;
export const TIMELINE_MINIMAP_EXPANDED_HIT_STRIP_WIDTH = "22rem";

/**
 * The minimap overlays the viewport's left edge while the content column is
 * centered, so the side gutter between them shrinks under browser zoom or a
 * narrow pane. A fixed-width hover strip would then sit on top of the message
 * text and swallow its pointer events. Cap the strip's width so it never
 * extends past the gutter into the content column; 0 disables the strip.
 */
export function resolveTimelineMinimapHitStripWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return 0;
  }

  const contentWidth = Math.min(viewportWidth, TIMELINE_CONTENT_MAX_WIDTH);
  const sideGutter = Math.max(0, (viewportWidth - contentWidth) / 2);
  return Math.max(
    0,
    Math.min(
      TIMELINE_MINIMAP_HIT_STRIP_MAX_WIDTH,
      Math.floor(sideGutter) - TIMELINE_MINIMAP_HIT_STRIP_LEFT,
    ),
  );
}

/**
 * Once the preview is open, keep the full preview and the space leading to it
 * interactive. The collapsed strip remains gutter-capped so it cannot block
 * selecting message text.
 */
export function resolveTimelineMinimapInteractiveWidth(
  collapsedWidth: number,
  expanded: boolean,
): number | string {
  return expanded ? TIMELINE_MINIMAP_EXPANDED_HIT_STRIP_WIDTH : collapsedWidth;
}

function computeElapsedMs(startIso: string, endIso: string): number | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function maxIsoTimestamp(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (!Number.isFinite(aMs)) return b;
  if (!Number.isFinite(bMs)) return a;
  return bMs > aMs ? b : a;
}

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  updatedAt: string;
  streaming: boolean;
}

export type TimelineLatestTurn = Pick<
  OrchestrationLatestTurn,
  "turnId" | "state" | "startedAt" | "completedAt"
>;

export type MessagesTimelineRow =
  | {
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: WorkLogEntry[];
    }
  | {
      kind: "work-toggle";
      id: string;
      createdAt: string;
      groupId: string;
      hiddenCount: number;
      expanded: boolean;
      onlyToolEntries: boolean;
    }
  | {
      kind: "turn-fold";
      id: string;
      createdAt: string;
      turnId: TurnId;
      label: string;
      expanded: boolean;
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
      durationStart: string;
      showAssistantMeta: boolean;
      showAssistantCopyButton: boolean;
      assistantCopyStreaming: boolean;
      assistantTurnDiffSummary?: TurnDiffSummary | undefined;
      revertTurnCount?: number | undefined;
    }
  | {
      kind: "proposed-plan";
      id: string;
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | { kind: "working"; id: string; createdAt: string | null }
  | { kind: "interrupted"; id: string; createdAt: string | null; turnId: TurnId };

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && !message.streaming) {
      lastBoundary = message.updatedAt;
    }
  }

  return result;
}

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

export function resolveAssistantMessageCopyState({
  text,
  showCopyButton,
  streaming,
}: {
  text: string | null;
  showCopyButton: boolean;
  streaming: boolean;
}) {
  const hasText = text !== null && text.trim().length > 0;
  return {
    text: hasText ? text : null,
    visible: showCopyButton && hasText && !streaming,
  };
}

function deriveTerminalAssistantMessageIds(timelineEntries: ReadonlyArray<TimelineEntry>) {
  const lastAssistantMessageIdByResponseKey = new Map<string, string>();
  let nullTurnResponseIndex = 0;

  for (const timelineEntry of timelineEntries) {
    if (timelineEntry.kind !== "message") {
      continue;
    }
    const { message } = timelineEntry;
    if (message.role === "user") {
      nullTurnResponseIndex += 1;
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }

    const responseKey = message.turnId
      ? `turn:${message.turnId}`
      : `unkeyed:${nullTurnResponseIndex}`;
    lastAssistantMessageIdByResponseKey.set(responseKey, message.id);
  }

  return new Set(lastAssistantMessageIdByResponseKey.values());
}

interface TurnFold {
  turnId: TurnId;
  anchorEntryId: string;
  createdAt: string;
  hiddenEntryIds: ReadonlySet<string>;
  label: string;
}

/**
 * The session's running turn is authoritative when latestTurn briefly lags or
 * regresses behind it. Otherwise, the latest turn counts as unsettled while it
 * is still running (or has not recorded a completion). This is deliberately
 * keyed on turn lifecycle rather than transient working state: right after the
 * user sends a message, the previous turn is still the "active" one until the
 * server creates the new turn, and folding must not flicker through that window.
 */
export function deriveUnsettledTurnId(
  latestTurn: TimelineLatestTurn | null,
  runningTurnId: TurnId | null,
): TurnId | null {
  if (runningTurnId !== null) {
    return runningTurnId;
  }
  if (!latestTurn) {
    return null;
  }
  const isSettled = latestTurn.completedAt !== null && latestTurn.state !== "running";
  return isSettled ? null : latestTurn.turnId;
}

export interface TimelineSettleFoldState {
  readonly threadKey: string;
  readonly unsettledTurnId: TurnId | null;
}

export interface TimelineSettleFoldDecision {
  readonly next: TimelineSettleFoldState;
  /**
   * The turn that just settled in this session and must NOT fold yet, or
   * `null`. See {@link resolveTimelineSettleFold}.
   */
  readonly deferFoldForTurnId: TurnId | null;
}

/**
 * Detects the settle edge so a turn can keep its work visible until the next
 * turn starts.
 *
 * Folding at the settle edge is what made the chat jump to the top of the
 * thread when a response finished. The fold deletes every work row and
 * non-terminal message of the turn in one commit — often thousands of pixels
 * of measured content sitting above the viewport. legend-list normally absorbs
 * that with `maintainVisibleContentPosition`, but MVCP is skipped outright
 * whenever an imperative `scrollToEnd` is already pending (`prepareMVCP`
 * returns early on `state.pendingScrollToEnd`), and settle is exactly when
 * ChatView fires one — the composer shrinks as the stop button goes away, and
 * the `timelineEntries` re-pin effect runs. Losing the compensation, the
 * browser clamps `scrollTop` to the much smaller content height (reading as a
 * jump toward the first message) and the pending scroll-to-end then slams back
 * down. Whether the race is lost varies per turn, which is why the jump was
 * intermittent.
 *
 * Deferring to the next turn removes the collapse from that race entirely, and
 * matches the interrupt precedent: an in-session interrupt likewise leaves its
 * turn expanded so the reader keeps their place. Deferral is session state, so
 * a reload folds the turn normally.
 */
export function resolveTimelineSettleFold(
  previous: TimelineSettleFoldState,
  input: TimelineSettleFoldState,
): TimelineSettleFoldDecision {
  // A different thread's settle edge is not this thread's business.
  if (previous.threadKey !== input.threadKey) {
    return { next: input, deferFoldForTurnId: null };
  }
  if (previous.unsettledTurnId === input.unsettledTurnId) {
    return { next: previous, deferFoldForTurnId: null };
  }

  const settledTurnId =
    previous.unsettledTurnId !== null && input.unsettledTurnId === null
      ? previous.unsettledTurnId
      : null;
  return { next: input, deferFoldForTurnId: settledTurnId };
}

/**
 * Settled turns fold their commentary and tool activity behind a
 * "Worked for ..." row anchored at the turn's first foldable entry; the
 * terminal assistant message stays visible below the fold.
 */
function deriveTurnFolds(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  terminalAssistantMessageIds: ReadonlySet<string>;
  latestTurn: TimelineLatestTurn | null;
  unsettledTurnId: TurnId | null;
}): ReadonlyMap<string, TurnFold> {
  interface TurnGroup {
    entries: Array<TimelineEntry>;
    terminalEntry: Extract<TimelineEntry, { kind: "message" }> | null;
    hasStreamingMessage: boolean;
    /**
     * The user message that kicked the turn off. Entry timestamps alone
     * undercount the duration (the first entry appears only once the
     * provider starts producing output), and a turn cut short by a steer may
     * hold a single instantaneous commentary message.
     */
    startBoundary: string | null;
  }
  const groupsByTurnId = new Map<TurnId, TurnGroup>();

  let pendingUserBoundary: string | null = null;
  for (const entry of input.timelineEntries) {
    if (entry.kind === "message" && entry.message.role === "user") {
      pendingUserBoundary = entry.message.createdAt;
      continue;
    }
    const turnId =
      entry.kind === "message" && entry.message.role === "assistant"
        ? (entry.message.turnId ?? null)
        : entry.kind === "work"
          ? (entry.entry.turnId ?? null)
          : null;
    if (!turnId) {
      continue;
    }
    let group = groupsByTurnId.get(turnId);
    if (!group) {
      group = {
        entries: [],
        terminalEntry: null,
        hasStreamingMessage: false,
        // Each user boundary starts at most one turn; a second turn after the
        // same user message (e.g. a steer-superseded continuation) falls back
        // to its own first entry.
        startBoundary: pendingUserBoundary,
      };
      pendingUserBoundary = null;
      groupsByTurnId.set(turnId, group);
    }
    group.entries.push(entry);
    if (entry.kind === "message") {
      if (input.terminalAssistantMessageIds.has(entry.message.id)) {
        group.terminalEntry = entry;
      }
      if (entry.message.streaming) {
        group.hasStreamingMessage = true;
      }
    }
  }

  const foldsByAnchorEntryId = new Map<string, TurnFold>();
  for (const [turnId, group] of groupsByTurnId) {
    if (turnId === input.unsettledTurnId) {
      continue;
    }
    if (group.hasStreamingMessage) {
      continue;
    }
    const hiddenEntryIds = new Set<string>();
    for (const entry of group.entries) {
      if (entry.id !== group.terminalEntry?.id) {
        hiddenEntryIds.add(entry.id);
      }
    }
    if (hiddenEntryIds.size === 0) {
      continue;
    }

    const firstEntry = group.entries[0];
    const lastEntry = group.entries.at(-1);
    if (!firstEntry || !lastEntry) {
      continue;
    }

    const isLatestInterruptedTurn =
      input.latestTurn?.turnId === turnId && input.latestTurn.state === "interrupted";
    // A turn cut short by a steer leaves trailing work entries behind its
    // terminal message — take whichever ended last.
    const lastEntryEnd =
      lastEntry.kind === "message" ? lastEntry.message.updatedAt : lastEntry.createdAt;
    const elapsedMs =
      input.latestTurn?.turnId === turnId &&
      input.latestTurn.startedAt &&
      input.latestTurn.completedAt
        ? computeElapsedMs(input.latestTurn.startedAt, input.latestTurn.completedAt)
        : computeElapsedMs(
            group.startBoundary ?? firstEntry.createdAt,
            maxIsoTimestamp(group.terminalEntry?.message.updatedAt ?? null, lastEntryEnd) ??
              lastEntryEnd,
          );
    const duration = elapsedMs !== null ? formatDuration(elapsedMs) : null;
    const label = isLatestInterruptedTurn
      ? duration
        ? `You stopped after ${duration}`
        : "You stopped this response"
      : duration
        ? `Worked for ${duration}`
        : "Worked";

    foldsByAnchorEntryId.set(firstEntry.id, {
      turnId,
      anchorEntryId: firstEntry.id,
      createdAt: firstEntry.createdAt,
      hiddenEntryIds,
      label,
    });
  }
  return foldsByAnchorEntryId;
}

// ---------------------------------------------------------------------------
// Tool-call lifecycle (plan item 6)
// ---------------------------------------------------------------------------

/**
 * The four lifecycle faces a tool row can present, plus `none` for log rows
 * that are not tool-like at all (context compaction, plain info) and therefore
 * own no completion semantics.
 */
export type TimelineToolStatus = "none" | "running" | "success" | "failure" | "neutral";

/**
 * The identity a tool row keeps across its whole lifecycle. `toolCallId` is
 * stable from `tool.started` through `tool.completed`; `id` is not — it is the
 * originating activity id and is swapped out at completion. The one-shot
 * completion flash and the running-trace ledger must key on this, or a running
 * row and its completion look like two different tools and the flash never arms.
 */
export function toolLifecycleFlashKey(entry: WorkLogEntry): string {
  return entry.toolCallId ?? entry.id;
}

/**
 * A tool call is "running" only while its own turn is still unsettled. Once the
 * turn ends, an entry left at `inProgress` is stale rather than live — treating
 * it as running would leave a spinner turning forever in restored history.
 */
export function isRunningToolWorkEntry(
  entry: WorkLogEntry,
  unsettledTurnId: TurnId | null,
): boolean {
  if (unsettledTurnId === null) return false;
  if (entry.toolLifecycleStatus !== "inProgress") return false;
  if (!workLogEntryIsToolLike(entry)) return false;
  if (workEntryIndicatesToolFailure(entry)) return false;
  const turnId = entry.turnId ?? null;
  return turnId === null || turnId === unsettledTurnId;
}

export function resolveWorkEntryToolStatus(
  entry: WorkLogEntry,
  unsettledTurnId: TurnId | null,
): TimelineToolStatus {
  if (!workLogEntryIsToolLike(entry)) return "none";
  if (workEntryIndicatesToolFailure(entry)) return "failure";
  if (isRunningToolWorkEntry(entry, unsettledTurnId)) return "running";
  if (workEntryIndicatesToolSuccess(entry)) return "success";
  return "neutral";
}

/**
 * Settled tool rows with no outcome are noise and stay hidden, but a tool that
 * is running right now is the one row item 6's running trace attaches to.
 */
function workEntryIsHiddenNeutral(entry: WorkLogEntry, unsettledTurnId: TurnId | null): boolean {
  return (
    workEntryIndicatesToolNeutralStatus(entry) && !isRunningToolWorkEntry(entry, unsettledTurnId)
  );
}

// ---------------------------------------------------------------------------
// One-shot lifecycle ledger (plan items 5, 6, 10)
// ---------------------------------------------------------------------------

/**
 * Replay prevention lives here, in one place, for a specific reason: the
 * timeline is virtualized, so a row component's mount is *not* a lifecycle
 * event. Rows unmount and remount purely because the user scrolled. Anything
 * that keys a one-shot animation off `useState`/`useEffect` inside a row will
 * replay on every remount, on scroll restoration, on history hydration, and
 * every time a fold or work group expands and pushes older rows back into the
 * data array.
 *
 * So the list owner advances this ledger from the *full* row array (which
 * virtualization does not touch) and hands each row a plain boolean. The
 * ledger:
 *
 *   - treats the first snapshot of a thread as history and emits nothing;
 *   - resets on thread change, so returning to a thread re-hydrates silently;
 *   - marks an identity as seen at the moment it emits, so re-advancing over
 *     the same content is inert;
 *   - only ever emits for a transition it personally observed (streaming ->
 *     settled, running -> success, absent -> newest user turn), never for
 *     content that merely appeared in an already-terminal state.
 */
export const TIMELINE_ONE_SHOT_TTL_MS = 260;

const EMPTY_LIFECYCLE_KEYS: ReadonlySet<string> = new Set<string>();

export interface TimelineLifecycleLedger {
  /** Row array identity the ledger was last advanced against. */
  readonly source: ReadonlyArray<MessagesTimelineRow> | null;
  readonly threadKey: string | null;
  readonly hydrated: boolean;
  readonly issuedAt: number;
  readonly seenUserMessageIds: ReadonlySet<string>;
  readonly streamingMessageIds: ReadonlySet<string>;
  readonly resolvedStreamMessageIds: ReadonlySet<string>;
  readonly runningToolIds: ReadonlySet<string>;
  readonly settledToolIds: ReadonlySet<string>;
  /** Newest assistant message that is actively streaming right now. */
  readonly liveEdgeMessageId: string | null;
  readonly arrivingUserMessageIds: ReadonlySet<string>;
  readonly resolvingStreamMessageIds: ReadonlySet<string>;
  readonly completingToolIds: ReadonlySet<string>;
}

export const EMPTY_TIMELINE_LIFECYCLE_LEDGER: TimelineLifecycleLedger = {
  source: null,
  threadKey: null,
  hydrated: false,
  issuedAt: 0,
  seenUserMessageIds: EMPTY_LIFECYCLE_KEYS,
  streamingMessageIds: EMPTY_LIFECYCLE_KEYS,
  resolvedStreamMessageIds: EMPTY_LIFECYCLE_KEYS,
  runningToolIds: EMPTY_LIFECYCLE_KEYS,
  settledToolIds: EMPTY_LIFECYCLE_KEYS,
  liveEdgeMessageId: null,
  arrivingUserMessageIds: EMPTY_LIFECYCLE_KEYS,
  resolvingStreamMessageIds: EMPTY_LIFECYCLE_KEYS,
  completingToolIds: EMPTY_LIFECYCLE_KEYS,
};

export function timelineLifecycleHasOneShots(ledger: TimelineLifecycleLedger): boolean {
  return (
    ledger.arrivingUserMessageIds.size > 0 ||
    ledger.resolvingStreamMessageIds.size > 0 ||
    ledger.completingToolIds.size > 0
  );
}

export function expireTimelineLifecycleOneShots(
  ledger: TimelineLifecycleLedger,
): TimelineLifecycleLedger {
  if (!timelineLifecycleHasOneShots(ledger)) return ledger;
  return {
    ...ledger,
    arrivingUserMessageIds: EMPTY_LIFECYCLE_KEYS,
    resolvingStreamMessageIds: EMPTY_LIFECYCLE_KEYS,
    completingToolIds: EMPTY_LIFECYCLE_KEYS,
  };
}

/** Union that preserves the base reference when nothing is added, so context
 *  values built from these sets stay identity-stable across streaming ticks. */
function withLifecycleKeys(
  base: ReadonlySet<string>,
  additions: Iterable<string>,
): ReadonlySet<string> {
  let next: Set<string> | null = null;
  for (const value of additions) {
    if (base.has(value)) continue;
    next ??= new Set(base);
    next.add(value);
  }
  return next ?? base;
}

interface TimelineLifecycleObservation {
  readonly userMessageIds: string[];
  readonly newestUserMessageId: string | null;
  readonly streamingMessageIds: Set<string>;
  readonly settledAssistantIds: Set<string>;
  readonly interruptedAssistantIds: Set<string>;
  readonly runningToolIds: Set<string>;
  readonly successToolIds: Set<string>;
  readonly terminalToolIds: Set<string>;
  readonly liveEdgeMessageId: string | null;
}

function observeTimelineLifecycle(
  rows: ReadonlyArray<MessagesTimelineRow>,
  unsettledTurnId: TurnId | null,
  interruptedTurnId: TurnId | null,
): TimelineLifecycleObservation {
  const userMessageIds: string[] = [];
  const streamingMessageIds = new Set<string>();
  const settledAssistantIds = new Set<string>();
  const interruptedAssistantIds = new Set<string>();
  const runningToolIds = new Set<string>();
  const successToolIds = new Set<string>();
  const terminalToolIds = new Set<string>();
  let newestUserMessageId: string | null = null;
  let liveEdgeMessageId: string | null = null;

  for (const row of rows) {
    if (row.kind === "message") {
      if (row.message.role === "user") {
        userMessageIds.push(row.message.id);
        newestUserMessageId = row.message.id;
        continue;
      }
      if (row.message.role !== "assistant") continue;
      const wasInterrupted = interruptedTurnId !== null && row.message.turnId === interruptedTurnId;
      // An interrupted turn is not a completion. Its content stops carrying the
      // live edge immediately, and it is recorded as already-resolved so the
      // completion glint can never fire for it — celebrating a stop would be
      // exactly the wrong signal.
      if (row.message.streaming && !wasInterrupted) {
        streamingMessageIds.add(row.message.id);
        liveEdgeMessageId = row.message.id;
      } else {
        settledAssistantIds.add(row.message.id);
        if (wasInterrupted) interruptedAssistantIds.add(row.message.id);
      }
      continue;
    }
    if (row.kind !== "work") continue;
    for (const entry of row.groupedEntries) {
      const status = resolveWorkEntryToolStatus(entry, unsettledTurnId);
      // Key on the stable tool-call identity, not `entry.id`: `id` is the
      // originating activity id and is replaced the instant the tool completes
      // (`tool.updated` -> `tool.completed`), so a set keyed on it can never
      // match a running row against its own completion. The flash keyed here
      // was therefore always empty. See `toolLifecycleFlashKey`.
      const key = toolLifecycleFlashKey(entry);
      if (status === "running") {
        runningToolIds.add(key);
        continue;
      }
      if (status === "none") continue;
      terminalToolIds.add(key);
      if (status === "success") successToolIds.add(key);
    }
  }

  return {
    userMessageIds,
    newestUserMessageId,
    streamingMessageIds,
    settledAssistantIds,
    interruptedAssistantIds,
    runningToolIds,
    successToolIds,
    terminalToolIds,
    liveEdgeMessageId,
  };
}

export interface TimelineLifecycleInput {
  readonly rows: ReadonlyArray<MessagesTimelineRow>;
  readonly threadKey: string;
  /** Suppress one-shots while persisted catch-up is becoming one snapshot. */
  readonly initialHydration?: boolean;
  readonly unsettledTurnId: TurnId | null;
  /** Latest turn when it settled as interrupted, so a stop never reads as a win. */
  readonly interruptedTurnId: TurnId | null;
  readonly now: number;
}

export function advanceTimelineLifecycle(
  input: TimelineLifecycleInput,
  previous: TimelineLifecycleLedger,
): TimelineLifecycleLedger {
  const initialHydration = input.initialHydration === true;
  // Re-advancing over the identical snapshot must be inert. This is what makes
  // a virtualized remount, a scroll restoration, or a React double-render
  // incapable of re-triggering anything. Hydration intentionally bypasses this
  // fast path so an in-flight one-shot is cleared if a reconnect begins.
  if (
    !initialHydration &&
    previous.source === input.rows &&
    previous.threadKey === input.threadKey
  ) {
    return input.now - previous.issuedAt >= TIMELINE_ONE_SHOT_TTL_MS
      ? expireTimelineLifecycleOneShots(previous)
      : previous;
  }

  const seen = observeTimelineLifecycle(input.rows, input.unsettledTurnId, input.interruptedTurnId);

  // First snapshot of a thread is history by definition: record it, animate none
  // of it. The explicit hydration guard keeps taking this branch while cached
  // state and persisted catch-up collapse, so even multiple reducer publications
  // cannot masquerade as live arrivals. A thread switch takes it again too.
  if (initialHydration || !previous.hydrated || previous.threadKey !== input.threadKey) {
    return {
      source: input.rows,
      threadKey: input.threadKey,
      hydrated: true,
      issuedAt: input.now,
      seenUserMessageIds: new Set(seen.userMessageIds),
      streamingMessageIds: seen.streamingMessageIds,
      resolvedStreamMessageIds: seen.settledAssistantIds,
      runningToolIds: seen.runningToolIds,
      settledToolIds: seen.terminalToolIds,
      liveEdgeMessageId: seen.liveEdgeMessageId,
      arrivingUserMessageIds: EMPTY_LIFECYCLE_KEYS,
      resolvingStreamMessageIds: EMPTY_LIFECYCLE_KEYS,
      completingToolIds: EMPTY_LIFECYCLE_KEYS,
    };
  }

  const expired = input.now - previous.issuedAt >= TIMELINE_ONE_SHOT_TTL_MS;
  const carriedArrivals = expired ? EMPTY_LIFECYCLE_KEYS : previous.arrivingUserMessageIds;
  const carriedGlints = expired ? EMPTY_LIFECYCLE_KEYS : previous.resolvingStreamMessageIds;
  const carriedFlashes = expired ? EMPTY_LIFECYCLE_KEYS : previous.completingToolIds;

  // Only the newest user turn arrives. A batch of older user messages appearing
  // at once (fold expansion, history backfill, reconnection replay) is recorded
  // silently.
  const arrivingUserMessageIds =
    seen.newestUserMessageId !== null && !previous.seenUserMessageIds.has(seen.newestUserMessageId)
      ? withLifecycleKeys(carriedArrivals, [seen.newestUserMessageId])
      : carriedArrivals;

  const glintIds: string[] = [];
  for (const messageId of previous.streamingMessageIds) {
    if (seen.streamingMessageIds.has(messageId)) continue;
    // Gone from the row array entirely (reverted / folded away) is not a
    // completion, and neither is a message we already saw settle.
    if (!seen.settledAssistantIds.has(messageId)) continue;
    if (seen.interruptedAssistantIds.has(messageId)) continue;
    if (previous.resolvedStreamMessageIds.has(messageId)) continue;
    glintIds.push(messageId);
  }
  const resolvingStreamMessageIds = withLifecycleKeys(carriedGlints, glintIds);

  const flashIds: string[] = [];
  for (const toolId of previous.runningToolIds) {
    if (seen.runningToolIds.has(toolId)) continue;
    if (!seen.successToolIds.has(toolId)) continue;
    if (previous.settledToolIds.has(toolId)) continue;
    flashIds.push(toolId);
  }
  const completingToolIds = withLifecycleKeys(carriedFlashes, flashIds);

  const emitted =
    arrivingUserMessageIds !== carriedArrivals ||
    resolvingStreamMessageIds !== carriedGlints ||
    completingToolIds !== carriedFlashes;

  return {
    source: input.rows,
    threadKey: input.threadKey,
    hydrated: true,
    issuedAt: emitted ? input.now : previous.issuedAt,
    seenUserMessageIds: withLifecycleKeys(previous.seenUserMessageIds, seen.userMessageIds),
    streamingMessageIds: seen.streamingMessageIds,
    resolvedStreamMessageIds: withLifecycleKeys(
      previous.resolvedStreamMessageIds,
      seen.settledAssistantIds,
    ),
    runningToolIds: seen.runningToolIds,
    settledToolIds: withLifecycleKeys(previous.settledToolIds, seen.terminalToolIds),
    liveEdgeMessageId: seen.liveEdgeMessageId,
    arrivingUserMessageIds,
    resolvingStreamMessageIds,
    completingToolIds,
  };
}

export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  latestTurn?: TimelineLatestTurn | null;
  runningTurnId?: TurnId | null;
  expandedTurnIds?: ReadonlySet<TurnId>;
  expandedWorkGroupIds?: ReadonlySet<string>;
  isWorking: boolean;
  activeTurnStartedAt: string | null;
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, TurnDiffSummary>;
  revertTurnCountByUserMessageId: ReadonlyMap<MessageId, number>;
  /**
   * Keeps settled tool rows that carry no success/failure outcome — thinking
   * blocks and tools still in flight when the record was taken.
   *
   * The live conversation hides them as noise, which is right when the reader
   * also has the running view to look at. A replayed transcript has no live
   * view and is settled by definition, so the same filter would hide the
   * agent's reasoning and its in-flight work — the substance of the record.
   */
  keepNeutralWorkEntries?: boolean;
  /**
   * Exempts failed tool calls from the "show N more" group collapse.
   *
   * Same reasoning as {@link keepNeutralWorkEntries}: while a turn is live the
   * reader watches work scroll past, so collapsing to the newest row loses
   * nothing. Replaying a record, the failure is usually the reason you opened
   * it, and it must not sit behind a disclosure.
   */
  pinFailedWorkEntries?: boolean;
}): MessagesTimelineRow[] {
  const nextRows: MessagesTimelineRow[] = [];
  const durationStartByMessageId = computeMessageDurationStart(
    input.timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
  );
  const terminalAssistantMessageIds = deriveTerminalAssistantMessageIds(input.timelineEntries);
  const unsettledTurnId = deriveUnsettledTurnId(
    input.latestTurn ?? null,
    input.runningTurnId ?? null,
  );
  const foldsByAnchorEntryId = deriveTurnFolds({
    timelineEntries: input.timelineEntries,
    terminalAssistantMessageIds,
    latestTurn: input.latestTurn ?? null,
    unsettledTurnId,
  });
  const collapsedEntryIds = new Set<string>();
  for (const fold of foldsByAnchorEntryId.values()) {
    if (!input.expandedTurnIds?.has(fold.turnId)) {
      for (const entryId of fold.hiddenEntryIds) {
        collapsedEntryIds.add(entryId);
      }
    }
  }

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    const turnFold = foldsByAnchorEntryId.get(timelineEntry.id);
    if (turnFold) {
      nextRows.push({
        kind: "turn-fold",
        id: `turn-fold:${turnFold.turnId}`,
        createdAt: turnFold.createdAt,
        turnId: turnFold.turnId,
        label: turnFold.label,
        expanded: input.expandedTurnIds?.has(turnFold.turnId) ?? false,
      });
    }

    if (collapsedEntryIds.has(timelineEntry.id)) {
      continue;
    }

    if (timelineEntry.kind === "work") {
      const groupedEntries = [timelineEntry.entry];
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (
          !nextEntry ||
          nextEntry.kind !== "work" ||
          collapsedEntryIds.has(nextEntry.id) ||
          foldsByAnchorEntryId.has(nextEntry.id)
        ) {
          break;
        }
        groupedEntries.push(nextEntry.entry);
        cursor += 1;
      }
      const visibleGroupedEntries =
        input.keepNeutralWorkEntries === true
          ? groupedEntries
          : groupedEntries.filter((entry) => !workEntryIsHiddenNeutral(entry, unsettledTurnId));
      if (visibleGroupedEntries.length > 0) {
        if (visibleGroupedEntries.length <= MAX_VISIBLE_WORK_LOG_ENTRIES) {
          nextRows.push({
            kind: "work",
            id: timelineEntry.id,
            createdAt: timelineEntry.createdAt,
            groupedEntries: visibleGroupedEntries,
          });
        } else {
          const groupId = `work-group:${timelineEntry.id}`;
          const expanded = input.expandedWorkGroupIds?.has(groupId) ?? false;
          const tailEntries = visibleGroupedEntries.slice(-MAX_VISIBLE_WORK_LOG_ENTRIES);
          // A failed call is the highest-signal row in a group; collapsing it
          // behind "show N more" while a neighbouring success stays visible
          // buries the one thing worth reading.
          const pinnedEntries =
            input.pinFailedWorkEntries === true
              ? visibleGroupedEntries.filter(
                  (entry) => workEntryIndicatesToolFailure(entry) || tailEntries.includes(entry),
                )
              : tailEntries;
          const hiddenEntries = visibleGroupedEntries.filter(
            (entry) => !pinnedEntries.includes(entry),
          );
          const renderedEntries = expanded ? visibleGroupedEntries : pinnedEntries;

          for (const workEntry of renderedEntries) {
            nextRows.push({
              kind: "work",
              id: workEntry.id,
              createdAt: workEntry.createdAt,
              groupedEntries: [workEntry],
            });
          }

          // Pinning can leave nothing hidden, and a "show 0 more" control is
          // just noise.
          if (hiddenEntries.length > 0) {
            nextRows.push({
              kind: "work-toggle",
              id: `work-toggle:${timelineEntry.id}`,
              createdAt: timelineEntry.createdAt,
              groupId,
              hiddenCount: hiddenEntries.length,
              expanded,
              onlyToolEntries: visibleGroupedEntries.every((entry) =>
                workLogEntryIsToolLike(entry),
              ),
            });
          }
        }
      }
      index = cursor - 1;
      continue;
    }

    if (timelineEntry.kind === "proposed-plan") {
      nextRows.push({
        kind: "proposed-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      });
      continue;
    }

    const assistantTurnStillInProgress =
      timelineEntry.message.role === "assistant" &&
      unsettledTurnId !== null &&
      timelineEntry.message.turnId === unsettledTurnId;

    const durationStart =
      durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt;

    // While the turn is still running, the latest assistant message is only
    // provisionally terminal — withhold the metadata row until the turn
    // settles so commentary doesn't flash timestamps mid-work.
    const showAssistantMeta =
      timelineEntry.message.role === "assistant" &&
      terminalAssistantMessageIds.has(timelineEntry.message.id) &&
      !assistantTurnStillInProgress;

    nextRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart,
      showAssistantMeta,
      showAssistantCopyButton: showAssistantMeta,
      assistantCopyStreaming: timelineEntry.message.streaming || assistantTurnStillInProgress,
      assistantTurnDiffSummary:
        timelineEntry.message.role === "assistant"
          ? input.turnDiffSummaryByAssistantMessageId.get(timelineEntry.message.id)
          : undefined,
      revertTurnCount:
        timelineEntry.message.role === "user"
          ? input.revertTurnCountByUserMessageId.get(timelineEntry.message.id)
          : undefined,
    });
  }

  if (input.isWorking) {
    nextRows.push({
      kind: "working",
      id: "working-indicator-row",
      createdAt: input.activeTurnStartedAt,
    });
  } else if (input.latestTurn?.state === "interrupted") {
    // Interrupted is a persistence state of its own, distinct from completion
    // and from failure. It replaces the working indicator once the stop lands
    // so the response never just stops with no explanation.
    nextRows.push({
      kind: "interrupted",
      id: "interrupted-indicator-row",
      createdAt: input.latestTurn.completedAt,
      turnId: input.latestTurn.turnId,
    });
  }

  return nextRows;
}

export function computeStableMessagesTimelineRows(
  rows: MessagesTimelineRow[],
  previous: StableMessagesTimelineRowsState,
): StableMessagesTimelineRowsState {
  const next = new Map<string, MessagesTimelineRow>();
  let anyChanged = rows.length !== previous.byId.size;

  const result = rows.map((row, index) => {
    const prevRow = previous.byId.get(row.id);
    const nextRow = prevRow && isRowUnchanged(prevRow, row) ? prevRow : row;
    next.set(row.id, nextRow);
    if (!anyChanged && previous.result[index] !== nextRow) {
      anyChanged = true;
    }
    return nextRow;
  });

  return anyChanged ? { byId: next, result } : previous;
}

/** Shallow field comparison per row variant — avoids deep equality cost. */
function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;

  switch (a.kind) {
    case "working":
      return a.createdAt === (b as typeof a).createdAt;

    case "interrupted": {
      const bi = b as typeof a;
      return a.createdAt === bi.createdAt && a.turnId === bi.turnId;
    }

    case "turn-fold": {
      const bf = b as typeof a;
      return a.createdAt === bf.createdAt && a.label === bf.label && a.expanded === bf.expanded;
    }

    case "proposed-plan":
      return a.proposedPlan === (b as typeof a).proposedPlan;

    case "work":
      return Equal.equals(a.groupedEntries, (b as typeof a).groupedEntries);

    case "work-toggle": {
      const bw = b as typeof a;
      return (
        a.createdAt === bw.createdAt &&
        a.groupId === bw.groupId &&
        a.hiddenCount === bw.hiddenCount &&
        a.expanded === bw.expanded &&
        a.onlyToolEntries === bw.onlyToolEntries
      );
    }

    case "message": {
      const bm = b as typeof a;
      return (
        a.message === bm.message &&
        a.durationStart === bm.durationStart &&
        a.showAssistantMeta === bm.showAssistantMeta &&
        a.showAssistantCopyButton === bm.showAssistantCopyButton &&
        a.assistantCopyStreaming === bm.assistantCopyStreaming &&
        a.assistantTurnDiffSummary === bm.assistantTurnDiffSummary &&
        a.revertTurnCount === bm.revertTurnCount
      );
    }
  }
}
