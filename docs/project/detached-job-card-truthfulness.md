# Detached-Job Agent Cards: Making "running" Always Mean Running

**Written 2026-07-29.** Everything learned about why the sub-agents sidebar drifts out of sync
with detached Codex companion jobs, and the design that makes it structurally truthful. Companion
docs: `KNOWN-ISSUES.md` (the fixed entries this builds on), `docs/project/ideal-agents-sidebar.md`
(the broader roadmap), `.codex-briefs/` (raw agent reports from the 2026-07-29 fix sweep).

## The problem, stated as an invariant

The sidebar must satisfy: **a detached job's card shows `running` if and only if the job is
actually running, and settles (with the real outcome) when the job ends — within one refresh
interval, regardless of restarts, missed events, or where the job was launched from.**

Both violation directions were observed live on 2026-07-29:

- **Card finished, job working.** A rescue forwarder card settled green at 9.9 s while its
  detached job (`task-ms5vrugq…`, later `task-ms5w4ysp…`) ran on for many minutes, invisible.
- **Card running, job dead.** (Historical, fixed for the restart case.) Cards ticked `running`
  for 40+ minutes after their job completed, surviving reloads and cold starts.

## Root cause in one sentence

Card state is **edge-triggered** — it changes only when the server happens to observe an event
(a launch line in live output, a watcher's terminal snapshot) — while the ground truth lives
elsewhere (the plugin's job state store, the worker process, the job log, the rollout
transcript). Every missed edge produces a permanent lie in one direction or the other.

## The event chain today, and every link that can break

1. Rescue forwarder (a normal sub-agent) launches the detached job and exits in ~30 s. Its own
   `task.completed` settles the card green unless something re-pins it. **Break: the wrapper's
   completion races the re-pin (observed).**
2. `ClaudeAdapter.startCompanionWatcher` attaches only when it _observes the launch line_ in live
   output. **Break: heuristic string correlation; miss the line → no watcher, ever.**
3. The watcher tails the job record in the state store at
   `~/.claude/plugins/data/codex-openai-codex/state/<workspace-hash>/state.json`. **Break: the
   hash is keyed to the job's `--cwd`. A job launched with a different cwd lands in a different
   store and is structurally invisible to the reader (observed: the plugin-patch job landed in
   `1.0.6-8bdf990fd9353194/` instead of `v3code-441497de03b09e93/`).**
4. The watcher emits the terminal `agent.snapshot` when the record settles. **Break (fixed
   2026-07-29 for restarts): the watcher was in-memory only; a server restart killed it and
   nothing rehydrated it. Startup reconciliation now re-attaches/settles — but only at startup,
   and only for the store it knows about.**
5. The record itself can lie: a worker that dies without its `finally` (crash, external kill)
   leaves `queued`/`running` forever — the plugin has **no liveness reconciliation and no
   heartbeat**. (Observed: `task-ms5vrugq-it8r0z` died ~1 s after spawn — the plugin's
   spawn-before-record-write enqueue race — and its record is stuck `queued` to this day.)

## The robust design (decided, not yet implemented)

Invert the model: **card state is a periodically recomputed function of ground truth, never a
memory of the last event seen.** Five parts, priority order:

### In-repo (apps/server + client)

1. **Authoritative ownership handoff.** The moment a forwarder yields a job id, the card's
   lifecycle belongs to the job; the wrapper's own `task.completed` is suppressed for display.
   Kills the re-pin race at the source. (Panel agent's top server recommendation, 2026-07-29.)
2. **Deterministic correlation.** Stop sniffing log lines. The job record should carry the
   launching thread id (the plugin already stamps `CODEX_COMPANION_SESSION_ID`; extend to thread)
   and the server looks jobs up by thread. No attach window to miss.
3. **Continuous, store-wide reconciler.** Promote the 2026-07-29 startup reconciliation into a
   periodic sweep (~15–30 s) over **all** directories under
   `~/.claude/plugins/data/codex-openai-codex/state/` — not just the current workspace's hash.
   Truth rule per job linked to a thread:
   `running ⇔ record says running ∧ PID alive (verified by creation time, never bare PID) ∧ log fresh`.
   Anything else → settle with the real outcome, or fail with an explicit reason
   (rollout `turn_aborted`, vanished record, dead PID + stale artifacts). Latency bound = sweep
   interval; that is what makes the invariant hold "within one refresh interval".
4. **Render only from the reconciled roster.** Timers from the job's true `startedAt`
   (not watcher-attach time — known gap), "Launching job" → "Detached job" labeling and truthful
   usage (`Usage unavailable`) already landed 2026-07-29 in `AgentsPanel.tsx` /
   `threadAgents.ts` (uncommitted).

### Plugin-side (goes in the fork — see the 📌 TODO in KNOWN-ISSUES.md)

4. **Worker heartbeat.** The worker bumps its record's `updatedAt` every few seconds even when
   quiet, and writes terminal records in a `finally`. "Record silent for N minutes" then becomes
   a reliable death signal instead of a guess. Also fix the enqueue race (write the request
   record BEFORE spawning the worker) and add PID+creation-time identity to the record.

## Where the code is

| Concern                                                  | Path                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| Watcher lifecycle + startup reconciliation (2026-07-29)  | `apps/server/src/provider/Layers/ClaudeAdapter.ts`                 |
| Job store reader, rollout correlation, abort detection   | `apps/server/src/provider/codexCompanionJobs.ts`                   |
| Roster fold / snapshot persistence / hydration trigger   | `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` |
| Card rendering, lifecycle labels, timers                 | `apps/web/src/components/AgentsPanel.tsx`                          |
| Roster reducer, terminal reconciliation, usage exclusion | `packages/client-runtime/src/state/threadAgents.ts`                |
| Plugin launch/SessionEnd/cancel (fork target)            | `~/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/`        |

## Verification bar for whoever implements this

- Kill a job externally mid-run → card fails with a reason within one sweep interval.
- Launch a job with a foreign `--cwd` → card still tracks it (store-wide sweep).
- Restart the server mid-job → card keeps running, then settles with the job (already covered by
  the 2026-07-29 restart tests; extend to the periodic path).
- Forwarder completes → card never shows green while the job record is non-terminal (race test).
- A fabricated `running` record with a dead PID → failed, record preserved, reason attached.
- Existing suites to keep green: `codexCompanionJobs.test.ts`, `ClaudeAdapter.test.ts`,
  `ProviderRuntimeIngestion.test.ts`, `threadAgents.test.ts`, `AgentsPanel.test.tsx`.

## Status at time of writing

- Restart reconciliation, abort/vanish detection, honest card labeling: **implemented,
  uncommitted, tests green** (2026-07-29 sweep; see KNOWN-ISSUES.md).
- Items 1–3 and the heartbeat: **designed here, not implemented.**
- The installed app build predates all of it — sidebar behavior in the running app reflects the
  old code until a build ships.
