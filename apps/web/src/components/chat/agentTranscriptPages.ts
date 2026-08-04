import type { AgentTranscriptItem } from "@t3tools/contracts";

/**
 * Accumulates transcript pages into one ordered record.
 *
 * Two things make this more than a concatenation:
 *
 * 1. **Refreshes restate items.** The panel re-reads a page when its agent
 *    settles, and those items are newer than the ones already held — a tool
 *    that was `running` is now `completed`. Skipping ids already present (the
 *    obvious dedupe) pins the stale copy forever, so matches are replaced.
 *
 * 2. **A tool call and its result can land on different pages.** The server
 *    pairs them within a page; across a boundary the call ships as `running`
 *    and the result arrives later as its own bare `Tool result` row. Merging
 *    the outcome back into the call keeps one card that reads correctly
 *    instead of a permanent spinner beside a detached result.
 */

type WorkItem = Extract<AgentTranscriptItem, { kind: "work" }>;

const isWork = (item: AgentTranscriptItem): item is WorkItem => item.kind === "work";

/**
 * A result whose call is elsewhere: the reader emits it with the tool-call id
 * but no `toolName`, because the name lives on the invocation it never saw.
 */
function isDetachedToolResult(item: AgentTranscriptItem): item is WorkItem {
  return isWork(item) && item.toolCallId !== undefined && item.toolName === undefined;
}

function applyResultTo(call: WorkItem, result: WorkItem): WorkItem {
  return {
    ...call,
    status: result.status,
    ...(result.outcome === undefined ? {} : { outcome: result.outcome }),
  };
}

export function mergeAgentTranscriptPages(
  existing: ReadonlyArray<AgentTranscriptItem>,
  incoming: ReadonlyArray<AgentTranscriptItem>,
): ReadonlyArray<AgentTranscriptItem> {
  const merged = [...existing];
  const indexById = new Map(merged.map((item, index) => [item.id, index]));
  /** Only invocations are pairing targets; a detached result is not one. */
  const callIndexByToolId = new Map(
    merged.flatMap((item, index) =>
      isWork(item) && item.toolCallId !== undefined && item.toolName !== undefined
        ? [[item.toolCallId, index] as const]
        : [],
    ),
  );

  for (const item of incoming) {
    const existingIndex = indexById.get(item.id);
    if (existingIndex !== undefined) {
      merged[existingIndex] = item;
      continue;
    }

    if (isDetachedToolResult(item)) {
      const callIndex = callIndexByToolId.get(item.toolCallId!);
      const call = callIndex === undefined ? undefined : merged[callIndex];
      if (callIndex !== undefined && call !== undefined && isWork(call)) {
        merged[callIndex] = applyResultTo(call, item);
        continue;
      }
    }

    indexById.set(item.id, merged.length);
    if (isWork(item) && item.toolCallId !== undefined && item.toolName !== undefined) {
      callIndexByToolId.set(item.toolCallId, merged.length);
    }
    merged.push(item);
  }

  // Pages can be loaded out of order; `ordinal` is absolute, so this is the
  // one place the record is put back into provider order.
  return merged.toSorted((left, right) =>
    left.ordinal !== undefined && right.ordinal !== undefined ? left.ordinal - right.ordinal : 0,
  );
}
