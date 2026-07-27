# Handoff: "Working for 8h" stuck-thread bug

Self-contained brief for an agent working **outside** V3 Code (the app must be closed to run the
repair, so this cannot be done from a chat inside it).

Repo: `C:\Users\vasus\Documents\v3code`. Read `AGENTS.md` before changing code.

---

## TL;DR

Interrupting a turn settles the turn row but never clears the session row. The UI reads the session
row, so the chat spins "Working for 8h" forever and the stop button does nothing — pressing stop is
what _creates_ the broken state.

Two jobs, independent:

1. **Repair** the user's stuck threads — script already written, just needs running. _Urgent._
2. **Fix the root cause** so it stops happening. _The real work._

---

## Symptom

- Chat header shows `Working for 7h 57m` / `8h 5m` and never stops.
- The red stop button does nothing.
- The model actually finished hours ago — its final reply exists but is never rendered.
- Long-standing: reproduced across `codex`, `grok`, and (per the user) other providers. Oldest
  affected thread dates to 2026-06-22.

---

## Diagnosis (verified against the live database)

Database: `C:\Users\vasus\.t3\userdata\state.sqlite` (~249 MB, the Insider install).

Three tables disagree. For thread `dd6725d5-221f-483e-8da0-de396a15b564`
("Fix double branding and enlarge banner"):

| Table                        | Field            | Value                                 |
| ---------------------------- | ---------------- | ------------------------------------- |
| `projection_turns`           | `state`          | `interrupted`                         |
| `projection_turns`           | `completed_at`   | `2026-07-27T05:18:16.435Z` ✅ settled |
| `projection_thread_sessions` | `status`         | `running` ❌ stale                    |
| `projection_thread_sessions` | `active_turn_id` | still set ❌ stale                    |
| `provider_session_runtime`   | `status`         | `running` ❌ stale                    |

Healthy rows always have `active_turn_id IS NULL` with status `ready` / `stopped` / `error`.

### The smoking gun

```sql
SELECT tu.state, COUNT(*) total,
       SUM(CASE WHEN s.active_turn_id = tu.turn_id AND s.status = 'running' THEN 1 ELSE 0 END) stuck
FROM projection_turns tu
LEFT JOIN projection_thread_sessions s ON s.thread_id = tu.thread_id
GROUP BY tu.state;
```

| turn state  | total | left session stuck   |
| ----------- | ----- | -------------------- |
| completed   | 189   | **0**                |
| error       | 2     | **0**                |
| interrupted | 3     | **3**                |
| running     | 1     | 1 _(genuinely live)_ |

**100% of `interrupted` turns leave a stuck session; 0% of `completed` or `error` turns do.** The
defect is isolated to the interrupt/stop path.

---

## Job 1 — repair the user's threads (do this first)

Script already written and dry-run validated: **`scripts/fix-stuck-threads.mjs`**.

```bash
# V3 CODE MUST BE FULLY CLOSED FIRST.
cd C:\Users\vasus\Documents\v3code
node scripts\fix-stuck-threads.mjs           # dry run
node scripts\fix-stuck-threads.mjs --apply   # backs up the DB, then fixes
```

It clears `active_turn_id` and sets `status='stopped'` on `projection_thread_sessions` and
`provider_session_runtime`, only for sessions whose active turn is provably settled. It refuses to
touch a genuinely running turn, backs up the DB first, and prints the restore command.

Verified dry-run output:

```
  SKIP  "Agents tab sub-agent status dots" — turn is genuinely running
  FIX   "IM stuck Step Grok"                     turn=interrupted completed 2026-06-22
  FIX   "Fix double branding and enlarge banner" turn=interrupted completed 2026-07-27T05:18:16
  FIX   "Spectacular send button animation polish" turn=interrupted completed 2026-07-26T21:17:59
```

**Do not delete or recreate the database.** Projections are cursor-based
(`projection_state.last_applied_sequence`, ~59808), not rebuilt on launch, so targeted edits persist.
The event log `orchestration_events` remains the source of truth and is untouched.

### The user's data is safe — do not "recover" it by other means

- Conversation history lives in `projection_thread_messages`, untouched.
- `provider_session_runtime.resume_cursor_json` survived on both chats and still points at the right
  Codex threads:
  - `dd6725d5-…` → `{"threadId":"019f9fd3-5a16-7f23-afa8-963a127be713"}`
  - `065af0fb-…` → `{"threadId":"019fa047-fe68-7583-bc11-a404224fe117"}`
- Full Codex transcripts on disk: `~/.codex/sessions/2026/07/27/rollout-<ts>-<threadId>.jsonl`.
  Resumable with `codex resume <threadId>`.
- ~8 hours of sub-agent file changes are already committed on `main`
  (commit `ecec7c900`, 102 files). Nothing is at risk.

**UNVERIFIED:** whether posting a new message to a repaired thread reattaches to the Codex thread
with full context or starts a fresh provider session. The cursor exists for that purpose; the
reattach path has not been traced. Worth confirming as part of Job 2.

---

## Job 2 — fix the root cause

**Hypothesis:** the code path that settles an _interrupted_ turn does not emit (or the projector does
not handle) whatever clears `projection_thread_sessions.active_turn_id` and resets `status`. The
`completed` path clearly does — 189 for 189.

### Where to look

| Area                            | Path                                                                  |
| ------------------------------- | --------------------------------------------------------------------- |
| Turn/session state machine      | `apps/server/src/orchestration/decider.ts`                            |
| Projection writer               | `apps/server/src/orchestration/projector.ts`                          |
| Session runtime rows            | `apps/server/src/provider/Layers/ProviderService.ts`                  |
| Interrupt handling per provider | `apps/server/src/provider/Layers/CodexAdapter.ts`, `ClaudeAdapter.ts` |

`apps/server/src/orchestration/projector.test.ts` already covers the clearing behaviour — it asserts
`activeTurnId: "turn-1"` → `activeTurnId: null` (~lines 293-324). So the mechanism exists and is
tested; find why the interrupt path misses it. Compare the event sequence emitted on a normal
completion against an interrupt.

### Suggested approach

1. Write a failing test first: interrupt a turn, assert the session row clears. It should reproduce
   the bug immediately given the 3-for-3 correlation.
2. Fix so any terminal turn state (`completed | interrupted | error`) clears the session.
3. Consider a defensive reconciliation on startup: any session whose `active_turn_id` points at a
   settled turn gets cleared. That converts a permanent wedge into a self-healing one, and would have
   silently fixed the June thread.
4. Also fix the stop button: it currently acts on a turn that is already settled, so it no-ops. It
   should clear stale session state rather than assume a live turn.

### Repo constraints (from AGENTS.md)

- Focused tests only: `node_modules/.bin/vp test run <files>` — bare `vp` is not on PATH.
- Never run repo-wide `vp check` / `vp run typecheck` / `vp run test`.
- **Never start a dev server or launch the app.** Ask the user to verify in the installed app.
- Backend changes must include focused tests.
- `packages/contracts` is schema-only — no runtime logic.

---

## Verification

After repair — expect 1 row (the live chat), not 4:

```sql
SELECT s.thread_id, t.title, s.status, s.active_turn_id, tu.state
FROM projection_thread_sessions s
LEFT JOIN projection_threads t  ON t.thread_id  = s.thread_id
LEFT JOIN projection_turns   tu ON tu.thread_id = s.thread_id AND tu.turn_id = s.active_turn_id
WHERE s.active_turn_id IS NOT NULL;
```

After the code fix: start a turn, press stop, confirm the session row clears and the spinner stops.

Query the DB read-only from Node (no sqlite3 CLI needed):

```js
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("C:/Users/vasus/.t3/userdata/state.sqlite", { readOnly: true });
```

---

## Context worth knowing

This bug is a primary reason the user forked the upstream app into V3 Code. It has been silently
wedging threads since at least June across multiple providers. Treat the root-cause fix as high
priority, and prefer the self-healing reconciliation in step 3 — the user has lost multi-hour
sessions to this repeatedly.

Related plan (separate work, same repo): `docs/project/ideal-agents-sidebar.md`.
