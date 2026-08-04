import { MessageId, type AgentTranscriptItem } from "@t3tools/contracts";

import type { TimelineEntry, WorkLogEntry } from "../../session-logic";

/**
 * Adapts a sub-agent transcript onto the main conversation's timeline model so
 * both surfaces render through the same row components.
 *
 * The mapping is deliberately total rather than lossy: every transcript item
 * becomes exactly one timeline entry, because the panel's whole purpose is to
 * show what the agent did, in the order it did it. Anything this function
 * drops is invisible to the user.
 */

/** Transcript items carry no turn, so nothing here participates in turn folding. */
const NO_TURN = null;

function toneFor(item: Extract<AgentTranscriptItem, { kind: "work" }>): WorkLogEntry["tone"] {
  if (item.category === "thinking") return "thinking";
  if (item.status === "failed") return "error";
  return "tool";
}

function lifecycleFor(
  status: Extract<AgentTranscriptItem, { kind: "work" }>["status"],
): NonNullable<WorkLogEntry["toolLifecycleStatus"]> {
  if (status === "running") return "inProgress";
  if (status === "failed") return "failed";
  return "completed";
}

/**
 * `detail` is the expanded body's free-text block. The invocation detail and
 * the result are concatenated rather than one replacing the other, so an
 * expanded tool card shows both what was asked and what came back — the same
 * information a main-chat tool row ends up with once its lifecycle collapses.
 */
function detailFor(item: Extract<AgentTranscriptItem, { kind: "work" }>): string | undefined {
  const blocks = [item.detail?.trim(), item.outcome?.trim()].filter(
    (block): block is string => block !== undefined && block.length > 0,
  );
  return blocks.length > 0 ? blocks.join("\n\n") : undefined;
}

/**
 * `createdAt` is display metadata here, not the sort key.
 *
 * Several blocks of one provider record share a timestamp, and some records
 * carry none, so it cannot order an interleaved transcript on its own. Rows
 * are emitted in `ordinal` order and `createdAt` is synthesized to agree with
 * it, so anything downstream that compares timestamps reaches the same answer.
 */
function createdAtFor(item: AgentTranscriptItem, index: number): string {
  return item.at ?? new Date(index).toISOString();
}

/**
 * Sorts by the server's absolute position when it is available, falling back
 * to array order. `ordinal` survives pagination; `at` does not.
 */
function compareByOrdinal(left: AgentTranscriptItem, right: AgentTranscriptItem): number {
  if (left.ordinal !== undefined && right.ordinal !== undefined) {
    return left.ordinal - right.ordinal;
  }
  return 0;
}

export function deriveAgentTranscriptTimelineEntries(
  items: ReadonlyArray<AgentTranscriptItem>,
): TimelineEntry[] {
  const ordered = [...items].sort(compareByOrdinal);
  return ordered.map((item, index): TimelineEntry => {
    const createdAt = createdAtFor(item, index);
    if (item.kind === "message") {
      return {
        id: item.id,
        kind: "message",
        createdAt,
        message: {
          id: MessageId.make(item.id),
          // `system` has no row of its own in the timeline; it reads as agent
          // output rather than as something the user said.
          role: item.role === "user" ? "user" : "assistant",
          text: item.text,
          turnId: NO_TURN,
          // A transcript is always read after the fact, never mid-stream.
          streaming: false,
          createdAt,
          updatedAt: createdAt,
        },
      };
    }

    const entry: WorkLogEntry = {
      id: item.id,
      createdAt,
      turnId: NO_TURN,
      label: item.label,
      tone: toneFor(item),
      toolLifecycleStatus: lifecycleFor(item.status),
      ...(detailFor(item) === undefined ? {} : { detail: detailFor(item)! }),
      ...(item.command === undefined ? {} : { command: item.command }),
      ...(item.changedFiles === undefined ? {} : { changedFiles: item.changedFiles }),
      ...(item.itemType === undefined ? {} : { itemType: item.itemType }),
      ...(item.toolName === undefined ? {} : { toolTitle: item.toolName }),
      ...(item.toolCallId === undefined ? {} : { toolCallId: item.toolCallId }),
    };
    return { id: item.id, kind: "work", createdAt, entry };
  });
}
