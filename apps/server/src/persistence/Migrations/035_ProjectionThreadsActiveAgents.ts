import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Surfaces the live subagent roster on the thread shell.
 *
 * The roster itself lives latest-wins inside `agent.snapshot` activity
 * payloads, which only the *open* thread loads. The sidebar needs the count
 * for every thread at once, so it is denormalized onto `projection_threads`
 * alongside the other shell summary counters (see migration 023).
 *
 * `agents_last_activity_at` exists so the client can discount a stale roster
 * at read time: when the server dies mid-run no terminal snapshot is ever
 * written, and the agents replay as `running` forever (see
 * scripts/fix-stuck-agent-cards.mjs). A write-time guard cannot fix that —
 * a dead process emits no further activities to trigger recomputation.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "active_agent_count")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN active_agent_count INTEGER NOT NULL DEFAULT 0
    `;
  }

  if (!columns.some((column) => column.name === "agents_last_activity_at")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN agents_last_activity_at TEXT
    `;
  }
});
