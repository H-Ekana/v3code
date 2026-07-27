# Known Issues

# 🔴 **INTERRUPTED TURNS WEDGE THE THREAD FOREVER**

## **STATUS: NOT FIXED. Repair script exists. Root cause is still live.**

**Pressing stop is what breaks the chat.** The turn settles, the session row never clears, and the
thread spins `Working for 8h` until someone edits the database by hand.

This is a primary reason V3 Code was forked. It has been silently wedging threads since at least
**2026-06-22**, across `codex`, `grok`, and `claudeAgent`. It directly defeats the product purpose —
"users can understand who is working, what each agent is doing" — because the panel lies about it.

---

## Symptom

- Header shows `Working for 7h 57m` and never stops.
- The red stop button does nothing.
- The model finished hours ago. Its final reply exists but is never rendered.
- Only recoverable by manually patching `state.sqlite`.

## Root cause

Three tables disagree after an interrupt:

| Table                        | Field                       | Value                          |
| ---------------------------- | --------------------------- | ------------------------------ |
| `projection_turns`           | `state` / `completed_at`    | `interrupted` / set ✅ settled |
| `projection_thread_sessions` | `status` / `active_turn_id` | `running` / still set ❌ stale |
| `provider_session_runtime`   | `status`                    | `running` ❌ stale             |

The UI reads the **session** row, so it reports work that finished hours earlier. Stop no-ops because
there is no live turn left to stop.

## Evidence — 100% correlation

Measured against a real 249 MB `state.sqlite`:

| turn state      | total | left session stuck |
| --------------- | ----- | ------------------ |
| completed       | 189   | **0**              |
| error           | 2     | **0**              |
| **interrupted** | **3** | **3**              |

**Every interrupted turn wedges its session. No completed or error turn ever does.** The defect is
isolated to the interrupt/stop path.

## Repair (data only — does NOT fix the bug)

```bash
# Close V3 Code first.
node scripts/fix-stuck-threads.mjs           # dry run
node scripts/fix-stuck-threads.mjs --apply   # backs up the DB, then clears stale rows
```

Only clears sessions whose active turn is provably settled; refuses to touch a live turn. Confirmed
working — recovered two 8-hour threads with full context and sub-agent history intact.

## Where to fix

| Area                       | Path                                                 |
| -------------------------- | ---------------------------------------------------- |
| Turn/session state machine | `apps/server/src/orchestration/decider.ts`           |
| Projection writer          | `apps/server/src/orchestration/projector.ts`         |
| Session runtime rows       | `apps/server/src/provider/Layers/ProviderService.ts` |

`projector.test.ts` (~293-324) **already asserts** `activeTurnId: "turn-1"` → `null`. The mechanism
exists and is tested — the interrupt path just misses it.

**Strongly recommended:** a startup reconciliation that clears any session whose `active_turn_id`
points at an already-settled turn. That turns a permanent wedge into a self-healing one, and would
have fixed the June thread automatically instead of leaving it broken for five weeks.

Full brief for an agent working outside the app: **`docs/project/stuck-thread-bug-handoff.md`**

---

# 🟡 Agents panel is provider-blind for detached jobs

A `codex:codex-rescue` sub-agent launches a **detached** Codex process and exits in ~30s, so its card
goes green while the real job runs for many more minutes, invisible to the roster. Users cannot tell
what is running without shelling out to `codex-companion.mjs status --json`.

Related: Claude sub-agents produce a far sparser activity feed than Codex ones — same UI, same
fields, but `task_progress` emits coarse periodic summaries where the Codex app-server emits a
separate item event per reasoning block, command and file change.

Plan, blocker register and roadmap: **`docs/project/ideal-agents-sidebar.md`**
