import type {
  AgentTranscriptItem,
  AgentTranscriptWorkCategory,
  ThreadAgentActivityKind,
  ThreadAgentSnapshot,
} from "@t3tools/contracts";

/**
 * Renders the roster's activity feed as transcript items.
 *
 * Some sub-agents have no retrievable transcript of the work that matters. The
 * `codex:codex-rescue` forwarder is the clear case: it makes one `Bash` call and
 * exits, while the Codex job it launched runs for minutes in a detached
 * process. The server tails that job and replays its progress onto the agent's
 * card, so the real story exists — just in the roster feed rather than in a
 * provider transcript.
 *
 * Mapping it into the same item shape lets the panel render one conversation
 * without caring which source it came from.
 *
 * What this cannot recover: the feed is bounded (50 entries, each truncated to
 * ~180 chars before it is persisted) and carries one summary line per event, so
 * there are no tool arguments and no result bodies. It is a faithful
 * chronology, not a full transcript.
 */

const ACTIVITY_CATEGORY: Record<ThreadAgentActivityKind, AgentTranscriptWorkCategory> = {
  reasoning: "thinking",
  planning: "other",
  investigating: "search",
  editing: "files",
  command: "command",
  verifying: "command",
  reviewing: "other",
  delegating: "delegation",
  reporting: "other",
  waiting: "other",
  other: "other",
};

const ACTIVITY_LABEL: Record<ThreadAgentActivityKind, string> = {
  reasoning: "Thinking",
  planning: "Planning",
  investigating: "Investigating",
  editing: "Editing files",
  command: "Ran a command",
  verifying: "Verifying",
  reviewing: "Reviewing",
  delegating: "Delegating",
  reporting: "Reporting",
  waiting: "Waiting",
  other: "Working",
};

export function deriveAgentActivityTranscriptItems(
  entries: ThreadAgentSnapshot["recentActivity"],
): ReadonlyArray<AgentTranscriptItem> {
  return entries.flatMap((entry, index): ReadonlyArray<AgentTranscriptItem> => {
    const summary = entry.summary.trim();
    if (summary.length === 0) return [];
    // Index participates in the id because the feed is deduplicated by rendered
    // label, not by identity — two entries can share a timestamp.
    const id = `activity:${index}:${entry.at}`;
    const kind = entry.kind ?? "other";

    // `reporting` is the agent narrating its own progress, so it reads as
    // speech rather than as a step it performed.
    if (kind === "reporting") {
      return [{ id, kind: "message", role: "assistant", text: summary, at: entry.at }];
    }

    return [
      {
        id,
        kind: "work",
        category: ACTIVITY_CATEGORY[kind],
        label: ACTIVITY_LABEL[kind],
        status:
          entry.outcome === "error"
            ? "failed"
            : entry.lifecycle === "started"
              ? "running"
              : "completed",
        at: entry.at,
        detail: summary,
      },
    ];
  });
}

/**
 * Activity categories a Codex child transcript provably cannot carry.
 *
 * `codex app-server`'s `thread/read` rebuilds items only from rollout
 * `event_msg` records. Shell executions and reasoning are written solely as
 * `response_item`s, so they are never reconstructed — a child that works by
 * running commands returns a transcript of `userMessage` and `agentMessage`
 * and nothing else. Verified against codex-cli 0.146.0 with `itemsView: "full"`.
 *
 * The same events *do* arrive live as `item/*` notifications and land in the
 * roster feed, so they are recoverable from there.
 *
 * Deliberately narrow. MCP calls, file changes and web searches are written as
 * `event_msg`s and therefore already appear in the transcript, in richer form;
 * merging those categories too would double every one of them.
 */
const CODEX_TRANSCRIPT_BLIND_CATEGORIES: ReadonlySet<AgentTranscriptWorkCategory> = new Set([
  "command",
  "thinking",
]);

function epochOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Interleaves the shell and reasoning steps the Codex transcript is blind to.
 *
 * This adds to the transcript rather than replacing it, which is the whole
 * reason it is safe: the two sources are complementary here, not competing.
 * Codex gives us the messages and the feed gives us the work, so the failure
 * mode of a bad merge is a duplicated row, never a lost transcript.
 *
 * Timestamps place the recovered steps, but an undated transcript item does not
 * act as a barrier — it inherits the last dated position instead, so a record
 * without `createdAt` cannot strand every later step at the end.
 */
export function mergeCodexActivityWork(
  transcriptItems: ReadonlyArray<AgentTranscriptItem>,
  activityItems: ReadonlyArray<AgentTranscriptItem>,
): ReadonlyArray<AgentTranscriptItem> {
  const recovered = activityItems
    .filter((item) => item.kind === "work" && CODEX_TRANSCRIPT_BLIND_CATEGORIES.has(item.category))
    .toSorted((left, right) => (epochOf(left.at) ?? 0) - (epochOf(right.at) ?? 0));
  if (recovered.length === 0) return transcriptItems;

  const merged: Array<AgentTranscriptItem> = [];
  let cursor = 0;
  let position = Number.NEGATIVE_INFINITY;
  for (const item of transcriptItems) {
    position = epochOf(item.at) ?? position;
    while (cursor < recovered.length && (epochOf(recovered[cursor]?.at) ?? 0) <= position) {
      merged.push(recovered[cursor]!);
      cursor += 1;
    }
    merged.push(item);
  }
  merged.push(...recovered.slice(cursor));

  // Renumbered because the feed carries no ordinal of its own, and both sorts
  // downstream compare `ordinal` only when *both* sides have one. Leaving these
  // rows unnumbered would hand their placement to sort stability.
  return merged.map((item, index) => ({ ...item, ordinal: index }));
}

/**
 * Chooses between the provider transcript and the roster feed.
 *
 * Keyed on *whether the agent delegates*, never on how much each source
 * currently holds. Comparing counts looks reasonable and is quietly wrong: the
 * transcript is fetched once and refreshed on settle, while the feed grows
 * live, so any threshold between them is a race. An ordinary sub-agent would
 * start on its real transcript, silently drop to one-line summaries partway
 * through the run as the feed overtook a frozen count, and claim to be a
 * delegated job while doing it.
 *
 * `delegateProvider` is the honest signal: it is set when the emitting adapter
 * is only a host for another provider's work, which is exactly the case where
 * the transcript describes a wrapper rather than the job. It is resolved
 * server-side at spawn time and does not change during a run.
 */
export function shouldPreferActivityFeed(input: {
  /** `delegateProvider` differs from `provider` — this agent hosts another provider's job. */
  readonly isDelegated: boolean;
  /**
   * `pending` is kept distinct from `unavailable` on purpose: treating a
   * not-yet-loaded transcript as absent made every panel open flash the feed,
   * and claim delegation, before the real transcript arrived.
   */
  readonly transcriptState: "pending" | "available" | "unavailable";
  readonly activityWorkCount: number;
}): boolean {
  if (input.activityWorkCount === 0) return false;
  // The wrapper's transcript is real but describes the shell, not the work.
  if (input.isDelegated) return true;
  // No transcript to be had: the feed is the only record rather than a downgrade.
  return input.transcriptState === "unavailable";
}
