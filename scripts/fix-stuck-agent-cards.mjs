#!/usr/bin/env node
/**
 * Settles agent cards that render as `running` forever.
 *
 * The per-thread agent roster is carried latest-wins in the payload of an
 * `agent.snapshot` thread activity (see `packages/contracts/src/threadAgents.ts`).
 * Nothing reaps it. If the server process dies while a companion job is still
 * being watched, the watcher fiber goes with it — and when the job finishes
 * later there is no longer anything alive to emit a snapshot carrying a terminal
 * status. The last snapshot written stays authoritative, so the card replays as
 * `running` through every reload and every cold restart.
 *
 * This appends a corrected snapshot. It does not fix the root cause: watchers
 * are still not rehydrated on startup.
 *
 * Usage:
 *   node scripts/fix-stuck-agent-cards.mjs            # dry run
 *   node scripts/fix-stuck-agent-cards.mjs --apply    # back up, then write
 *   node scripts/fix-stuck-agent-cards.mjs --stale-minutes 30
 *
 * Close V3 Code first. The app holds state.sqlite open, and a live server can
 * re-emit its own in-memory roster over anything written underneath it.
 */

import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped"]);
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const staleIdx = args.indexOf("--stale-minutes");
const staleMinutes = staleIdx === -1 ? 15 : Number(args[staleIdx + 1]);

if (!Number.isFinite(staleMinutes) || staleMinutes <= 0) {
  console.error("--stale-minutes must be a positive number");
  process.exit(1);
}

const dbPath =
  process.env.T3CODE_STATE_DB ?? NodePath.join(NodeOS.homedir(), ".t3", "userdata", "state.sqlite");

if (!NodeFS.existsSync(dbPath)) {
  console.error(`No database at ${dbPath}`);
  process.exit(1);
}

// A live app holds a WAL. Writing underneath it risks losing the change to the
// server's own roster, so refuse rather than half-work.
const wal = `${dbPath}-wal`;
if (apply && NodeFS.existsSync(wal) && NodeFS.statSync(wal).size > 0) {
  console.error(
    `Refusing to write: ${NodePath.basename(wal)} is non-empty, which usually means V3 Code is still running.\n` +
      `Close the app completely and re-run. (If it is definitely closed, the WAL is stale and safe to ignore — pass --force.)`,
  );
  if (!args.includes("--force")) process.exit(1);
}

const db = new NodeSqlite.DatabaseSync(dbPath);
// A live app holds the write lock in short bursts. Without a busy timeout the
// first contended INSERT fails outright; with one, we wait for a gap instead.
db.exec("PRAGMA busy_timeout = 10000");
const nowMs = Date.now();
const nowIso = new Date(nowMs).toISOString();

console.log(`Database: ${dbPath}`);
console.log(`Stale threshold: ${staleMinutes} minutes\n`);

const threads = db
  .prepare(
    `SELECT DISTINCT thread_id FROM projection_thread_activities WHERE kind = 'agent.snapshot'`,
  )
  .all();

const pending = [];

for (const { thread_id: threadId } of threads) {
  const row = db
    .prepare(
      `SELECT activity_id, turn_id, tone, payload_json, created_at
         FROM projection_thread_activities
        WHERE thread_id = ? AND kind = 'agent.snapshot'
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get(threadId);
  if (!row) continue;

  let payload;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    console.log(`  SKIP  ${threadId} — snapshot payload is not valid JSON`);
    continue;
  }

  const agents = Array.isArray(payload.agents) ? payload.agents : [];
  const stuck = agents.filter((a) => {
    if (TERMINAL_STATUSES.has(a.status) || a.status === "idle") return false;
    const last = Date.parse(a.lastActivityAt ?? a.updatedAt ?? row.created_at);
    return Number.isFinite(last) && nowMs - last > staleMinutes * 60_000;
  });

  if (stuck.length === 0) continue;

  const title =
    db.prepare(`SELECT title FROM projection_threads WHERE thread_id = ?`).get(threadId)?.title ??
    threadId;

  console.log(`Thread "${title}"`);
  for (const a of stuck) {
    const last = a.lastActivityAt ?? a.updatedAt ?? row.created_at;
    const mins = Math.round((nowMs - Date.parse(last)) / 60_000);
    console.log(`  STUCK ${a.agentId} "${a.name}" — ${a.status}, idle ${mins}m (last: ${last})`);
  }

  const settledAgents = agents.map((a) => {
    if (!stuck.includes(a)) return a;
    const endedAt = a.lastActivityAt ?? a.updatedAt ?? row.created_at;
    // Drop the live-run fields: `currentActivity` is what the card renders as
    // its running line, and their absence is what stops the client-side timer.
    const { currentActivity: _c, phaseTitle: _p, ...rest } = a;
    return {
      ...rest,
      status: "stopped",
      endedAt,
      updatedAt: nowIso,
      resultSummary:
        a.resultSummary ??
        `Settled by fix-stuck-agent-cards.mjs — no terminal snapshot was ever written (last activity ${endedAt}).`,
    };
  });

  const active = settledAgents.filter(
    (a) => !TERMINAL_STATUSES.has(a.status) && a.status !== "idle",
  ).length;

  pending.push({
    threadId,
    turnId: row.turn_id,
    tone: row.tone ?? "info",
    activityId: `${NodeCrypto.randomUUID()}:agent-snapshot:${NodeCrypto.randomUUID()}`,
    summary: `${active} agent${active === 1 ? "" : "s"} active`,
    payload: {
      ...payload,
      agents: settledAgents,
      revision: typeof payload.revision === "number" ? payload.revision + 1 : 1,
    },
  });
}

if (pending.length === 0) {
  console.log("Nothing stuck. No changes needed.");
  db.close();
  process.exit(0);
}

if (!apply) {
  console.log(`\nDry run. Re-run with --apply to append ${pending.length} corrected snapshot(s).`);
  db.close();
  process.exit(0);
}

const backup = `${dbPath}.bak-${nowMs}`;
NodeFS.copyFileSync(dbPath, backup);
console.log(`\nBacked up to ${backup}`);

const insert = db.prepare(
  `INSERT INTO projection_thread_activities
     (activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at, sequence)
   VALUES (?, ?, ?, ?, 'agent.snapshot', ?, ?, ?, NULL)`,
);

// `BEGIN IMMEDIATE` takes the write lock up front rather than discovering the
// contention at INSERT time, so busy_timeout actually gets a chance to wait.
let written = false;
for (let attempt = 1; attempt <= 3 && !written; attempt += 1) {
  try {
    db.exec("BEGIN IMMEDIATE");
    for (const p of pending) {
      insert.run(
        p.activityId,
        p.threadId,
        p.turnId,
        p.tone,
        p.summary,
        JSON.stringify(p.payload),
        nowIso,
      );
    }
    db.exec("COMMIT");
    written = true;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // No transaction was open; nothing to roll back.
    }
    const locked = String(error?.errstr ?? error).includes("locked");
    if (!locked || attempt === 3) {
      console.error(
        locked
          ? `\nStill locked after ${attempt} attempts. V3 Code holds the write lock — close it completely and re-run without --force.`
          : `Write failed, rolled back: ${error}`,
      );
      db.close();
      process.exit(1);
    }
    console.log(`  locked, retrying (${attempt}/3)...`);
  }
}

console.log(`Appended ${pending.length} corrected snapshot(s). Reopen V3 Code to see the change.`);
db.close();
