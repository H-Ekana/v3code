#!/usr/bin/env node
/**
 * Unstick threads whose turn finished but whose session row was never cleared.
 *
 * Symptom: chat shows "Working for 8h" forever, stop button does nothing.
 * Cause:   projection_turns says the turn is terminal (has completed_at), but
 *          projection_thread_sessions.active_turn_id is still set and
 *          status is still 'running'. The UI reads the session row.
 *
 * SAFETY: only clears a session whose active turn is genuinely settled
 * (terminal state or a non-null completed_at), or whose active turn row is
 * missing entirely. A live, still-running turn is never touched.
 *
 * Usage — CLOSE V3 CODE FIRST, then from the repo root:
 *   node scripts/fix-stuck-threads.mjs           # dry run, shows what it would do
 *   node scripts/fix-stuck-threads.mjs --apply   # back up the DB, then fix
 *   node scripts/fix-stuck-threads.mjs --apply --db "C:/path/to/state.sqlite"
 */
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dbFlag = args.indexOf("--db");
const dbPath =
  dbFlag !== -1 && args[dbFlag + 1]
    ? args[dbFlag + 1]
    : join(homedir(), ".t3", "userdata", "state.sqlite");

if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}\nPass --db <path> if yours lives elsewhere.`);
  process.exit(1);
}

// A turn is settled if it reached a terminal state or recorded a completion.
const TERMINAL_TURN_STATES = new Set(["completed", "interrupted", "error"]);

const db = new DatabaseSync(dbPath);

const candidates = db
  .prepare(
    `SELECT s.thread_id, s.status, s.provider_name, s.active_turn_id,
            t.title, tu.state AS turn_state, tu.completed_at
     FROM projection_thread_sessions s
     LEFT JOIN projection_threads t  ON t.thread_id  = s.thread_id
     LEFT JOIN projection_turns   tu ON tu.thread_id = s.thread_id
                                    AND tu.turn_id   = s.active_turn_id
     WHERE s.active_turn_id IS NOT NULL`,
  )
  .all();

const stuck = candidates.filter(
  (r) => r.turn_state === null || TERMINAL_TURN_STATES.has(r.turn_state) || r.completed_at !== null,
);
const live = candidates.filter((r) => !stuck.includes(r));

console.log(`Database: ${dbPath}`);
console.log(`Threads with an active turn: ${candidates.length}\n`);

for (const r of live) {
  console.log(`  SKIP  "${(r.title ?? "").slice(0, 48)}" — turn is genuinely ${r.turn_state}`);
}
for (const r of stuck) {
  console.log(
    `  FIX   "${(r.title ?? "").slice(0, 48)}"\n` +
      `        provider=${r.provider_name} session.status=${r.status} ` +
      `turn=${r.turn_state ?? "<missing>"} completed_at=${r.completed_at ?? "-"}`,
  );
}

if (stuck.length === 0) {
  console.log("\nNothing stuck. No changes needed.");
  process.exit(0);
}

if (!apply) {
  console.log(`\nDry run. ${stuck.length} thread(s) would be fixed.`);
  console.log("Re-run with --apply to back up the database and fix them.");
  process.exit(0);
}

const backup = `${dbPath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
copyFileSync(dbPath, backup);
console.log(`\nBacked up to:\n  ${backup}`);

const clearSession = db.prepare(
  `UPDATE projection_thread_sessions
   SET active_turn_id = NULL, status = 'stopped', updated_at = ?
   WHERE thread_id = ?`,
);
const clearRuntime = db.prepare(
  `UPDATE provider_session_runtime SET status = 'stopped', last_seen_at = ? WHERE thread_id = ?`,
);

const now = new Date().toISOString();
db.exec("BEGIN");
try {
  for (const r of stuck) {
    clearSession.run(now, r.thread_id);
    clearRuntime.run(now, r.thread_id);
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  console.error("\nFailed, rolled back. Database unchanged:", error);
  process.exit(1);
}

console.log(`\nFixed ${stuck.length} thread(s). resume_cursor_json was left untouched,`);
console.log("so each thread keeps the provider session it was attached to.");
console.log("\nReopen V3 Code — the spinners should be gone.");
console.log(`If anything looks wrong, restore with:\n  copy "${backup}" "${dbPath}"`);
