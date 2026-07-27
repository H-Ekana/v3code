# Known Issues

# [FIXED] PARENT CODEX OUTPUT DISAPPEARS AFTER A SUB-AGENT INTERACTS WITH `/root`

## **STATUS: FIXED IN THE WORKTREE ON 2026-07-27. Requires an updated app build/restart.**

A Codex parent could keep producing assistant messages, tool calls, file changes, and turn lifecycle
events while V3 Code stopped adding them to the conversation. The chat showed an old acknowledgement
and a permanent `Working for ...` spinner; later user messages received real backend replies that
were invisible in the GUI.

### Confirmed root cause

When a child communicated with its parent, Codex emitted a `subAgentActivity` item targeting the
canonical parent thread with `agentPath: "/root"`. `CodexSessionRuntime.rememberSubAgentActivity`
blindly registered that target as a child. Every later parent notification was then diverted into a
synthetic `collab/agentActivity` event and returned before normal conversation handling.

The adapter's existing bare-`/root` guard hid the bogus root agent card, but it could not restore the
already-diverted parent messages. The apparent steer/turn-id mismatch was a downstream symptom:
parent `turn/completed` and the next `turn/started` were diverted along with the assistant output.

### Verified evidence

Thread `065af0fb-1e86-44f5-a569-fd626f655df0` ("Spectacular send button animation polish"),
Codex session `019fa047-fe68-7583-bc11-a404224fe117`:

- The last projected assistant message finalized at `07:20:32Z`.
- At `07:21:19Z`, a child emitted `subAgentActivity` targeting the parent at `/root`.
- From that point onward, the native provider log wrapped parent notifications as
  `collab/agentActivity`; 840 wrapped parent assistant deltas never became canonical content events.
- The original provider turn completed at `07:31:22Z`, and the user's follow-up started another turn
  at `07:33:33Z`. V3 projected neither lifecycle event, so the GUI falsely appeared continuously
  active.
- The raw Codex session contains the missing replies and successful work through `07:43:03Z`.

### Resolution

`apps/server/src/provider/Layers/CodexSessionRuntime.ts` now:

- refuses to register bare `/root` activity or the canonical provider thread as a child;
- deletes a stale root entry when encountered so an already-poisoned runtime can self-heal; and
- independently prevents the canonical provider thread from ever taking the child diversion path.

Focused regression coverage in `CodexSessionRuntime.test.ts` verifies canonical-root rejection,
poisoned-registry safety, real nested-child routing, and existing v1 receiver routing.

### Recovery and diagnosis

- This is distinct from the interrupted-turn wedge below. `scripts/fix-stuck-threads.mjs` does not
  restore conversation events that were never projected.
- Existing missing messages are still available in the matching
  `~/.codex/sessions/.../rollout-...-<threadId>.jsonl`.
- Affected running processes need an updated build/restart before the fix applies.

---

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

# 🟢 FIXED — Codex root thread appeared as its own sub-agent

`CodexAdapter` derived an agent nickname from the last segment of Codex's `agentPath`
(`/root/marlow` → `marlow`). The parent conversation is a bare `/root`, so it became an agent
literally named **`root`** in the SUB-AGENTS list — showing the main thread's own replies as
"sub-agent activity", incrementing `run N` on every user turn, and summing its whole-conversation
token total (22.9M in one observed case) into the roster alongside the children it spawned.

Fixed by requiring path depth >= 2. `/root/root` still resolves correctly. Regression test asserts
a bare `/root` emits nothing; verified to fail without the guard.

---

# 🟡 Agents panel is provider-blind for detached jobs

A `codex:codex-rescue` sub-agent launches a **detached** Codex process and exits in ~30s, so its card
goes green while the real job runs for many more minutes, invisible to the roster. Users cannot tell
what is running without shelling out to `codex-companion.mjs status --json`.

Related: Claude sub-agents produce a far sparser activity feed than Codex ones — same UI, same
fields, but `task_progress` emits coarse periodic summaries where the Codex app-server emits a
separate item event per reasoning block, command and file change.

Plan, blocker register and roadmap: **`docs/project/ideal-agents-sidebar.md`**
