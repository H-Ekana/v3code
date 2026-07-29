import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Splits background work out of `active_agent_count`.
 *
 * Migration 035 denormalized "non-terminal roster rows" into a single count,
 * which made the sidebar say "1 agent" when the only live row was a `shell`
 * background task or `monitor`. Shell/monitor rows now land in
 * `active_background_task_count` so clients can label them honestly;
 * `active_agent_count` keeps only actual delegated agents.
 *
 * No backfill: the projection recomputes both counts on the thread's next
 * `agent.snapshot` activity. Settled threads already project 0, so a stale
 * split is only possible on a thread with live work — which is exactly the
 * thread still emitting snapshots.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "active_background_task_count")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN active_background_task_count INTEGER NOT NULL DEFAULT 0
    `;
  }
});
