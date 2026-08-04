import type { AgentTranscriptItem, MessageId, ScopedThreadRef, TurnId } from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { scopedThreadKey } from "@t3tools/client-runtime/environment";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { deriveAgentTranscriptTimelineEntries } from "./agentTranscriptTimeline";
import { deriveMessagesTimelineRows } from "./MessagesTimeline.logic";
import {
  TimelineRowActivityCtx,
  TimelineRowContent,
  TimelineRowCtx,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
} from "./MessagesTimeline";

/**
 * Renders a sub-agent transcript with the main conversation's row components.
 *
 * This is a plain list rather than an embedded {@link MessagesTimeline}: the
 * timeline owns its own scroll container, minimap and follow-output behaviour,
 * all of which would fight the panel's surrounding header. Sharing the rows —
 * not the list — is what makes a tool call look identical on both surfaces
 * while leaving scroll ownership with the panel.
 */

const EMPTY_TURN_DIFF_SUMMARIES: ReadonlyMap<
  MessageId,
  Parameters<
    typeof deriveMessagesTimelineRows
  >[0]["turnDiffSummaryByAssistantMessageId"] extends ReadonlyMap<MessageId, infer V>
    ? V
    : never
> = new Map();
const EMPTY_REVERT_COUNTS: ReadonlyMap<MessageId, number> = new Map();
const EMPTY_STRING_SET: ReadonlySet<string> = new Set();
const EMPTY_TURN_IDS: ReadonlySet<TurnId> = new Set();
const EMPTY_SKILLS: TimelineRowSharedState["skills"] = [];
const noop = () => {};

/**
 * Every user-role turn in a sub-agent transcript was written by the agent that
 * spawned it, not by the person reading the panel. Without a label the bubble
 * reads as something the reader said, which is the single most confusing thing
 * about replaying someone else's conversation.
 */
function isFromParentAgent(row: { kind: string; message?: { role: string } }): boolean {
  return row.kind === "message" && row.message?.role === "user";
}

interface AgentTranscriptConversationProps {
  items: ReadonlyArray<AgentTranscriptItem>;
  threadRef: ScopedThreadRef;
  markdownCwd: string | undefined;
}

export function AgentTranscriptConversation({
  items,
  threadRef,
  markdownCwd,
}: AgentTranscriptConversationProps) {
  const [expandedWorkGroupIds, setExpandedWorkGroupIds] =
    useState<ReadonlySet<string>>(EMPTY_STRING_SET);
  const { resolvedTheme } = useTheme();
  const timestampFormat = useEnvironmentSettings(
    threadRef.environmentId,
    (settings) => settings.timestampFormat,
  );

  const timelineEntries = useMemo(() => deriveAgentTranscriptTimelineEntries(items), [items]);

  const rows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        // A transcript has no turn lifecycle of its own, so turn folding, the
        // working row and revert affordances all stay switched off.
        latestTurn: null,
        runningTurnId: null,
        expandedTurnIds: EMPTY_TURN_IDS,
        expandedWorkGroupIds,
        isWorking: false,
        activeTurnStartedAt: null,
        turnDiffSummaryByAssistantMessageId: EMPTY_TURN_DIFF_SUMMARIES,
        revertTurnCountByUserMessageId: EMPTY_REVERT_COUNTS,
        // A transcript is settled by definition, so the live view's
        // hide-settled-neutral rule would drop the agent's reasoning and any
        // tool still in flight when the record was taken.
        keepNeutralWorkEntries: true,
        pinFailedWorkEntries: true,
      }),
    [expandedWorkGroupIds, timelineEntries],
  );

  const sharedState = useMemo<TimelineRowSharedState>(
    () => ({
      timestampFormat,
      routeThreadKey: scopedThreadKey(threadRef),
      threadRef,
      markdownCwd,
      resolvedTheme,
      // Only used to shorten changed-file paths; the agent worked in the
      // parent thread's checkout, so its cwd is the right root.
      workspaceRoot: markdownCwd,
      skills: EMPTY_SKILLS,
      activeThreadEnvironmentId: threadRef.environmentId,
      onRevertUserMessage: noop,
      onImageExpand: noop,
      onOpenTurnDiff: noop,
      onToggleTurnFold: noop,
      onToggleWorkGroup: (groupId) => {
        setExpandedWorkGroupIds((current) => {
          const next = new Set(current);
          if (!next.delete(groupId)) next.add(groupId);
          return next;
        });
      },
    }),
    [markdownCwd, resolvedTheme, threadRef, timestampFormat],
  );

  const activityState = useMemo<TimelineRowActivityState>(
    () => ({
      isWorking: false,
      isRevertingCheckpoint: false,
      activeTurnInProgress: false,
      latestTurnId: null,
      interruptState: "idle",
      // The one-shot animations key off these; a transcript is history, so
      // nothing should flash on open.
      unsettledTurnId: null,
      liveEdgeMessageId: null,
      arrivingUserMessageIds: EMPTY_STRING_SET,
      resolvingStreamMessageIds: EMPTY_STRING_SET,
      completingToolIds: EMPTY_STRING_SET,
    }),
    [],
  );

  if (rows.length === 0) return null;

  return (
    <TimelineRowCtx value={sharedState}>
      <TimelineRowActivityCtx value={activityState}>
        <div className="flex flex-col">
          {rows.map((row, index) => (
            <div key={row.id}>
              {isFromParentAgent(row) ? (
                <p className="mb-1 pr-1 text-right text-[11px] font-medium text-muted-foreground">
                  {index === 0 ? "Task from the main agent" : "From the main agent"}
                </p>
              ) : null}
              <TimelineRowContent row={row} />
            </div>
          ))}
        </div>
      </TimelineRowActivityCtx>
    </TimelineRowCtx>
  );
}
