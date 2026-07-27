# Known Issues

# 🟣 NEWLY COMPLETED THREAD CAN LOSE ITS `DONE` BADGE AND UNSEEN-COMPLETION GLOW

## **STATUS: CONFIRMED, NOT FIXED. Regression diagnosed on 2026-07-27.**

A thread that has just finished working can fall directly into the ordinary muted/inactive row
presentation. The row no longer says `Done`, does not show the themed completion check, and does not
receive the violet/pink unseen-completion glow—even when the user has not reopened the completed
thread to inspect its output.

### Observed symptom

- Let a background or current thread finish normally.
- Do not click or reopen that thread after completion.
- Its sidebar row becomes gray and visually indistinguishable from an older idle thread.
- Only the provider glyph remains on the right; there is no explicit completion state.

### Expected behavior

A newly completed, unseen thread should retain the themed `Done` check and bounded completion glow
until the user opens that thread. Opening it should acknowledge the completion and return the row to
its quiet seen/idle presentation. The state must remain understandable from the check and `Done`
label, not color alone.

### Confirmed primary root cause

The completed turn is persisted correctly, but the final ready-session event erases the thread
shell's pointer to it:

1. `thread.turn-diff-completed` writes the completed turn ID to
   `projection_threads.latest_turn_id`.
2. A later `thread.session-set` reports `status: "ready"` and `activeTurnId: null`.
3. `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` blindly replaces
   `latest_turn_id` with that null active-turn value.
4. `ProjectionSnapshotQuery` can then expose only `latestTurn: null` for the sidebar shell.
5. `hasUnseenCompletion` returns false immediately when `latestTurn` is absent, so neither the
   `Done` badge nor the completion glow can render.

This is a projection/state-ordering regression, not missing CSS, and it affects background threads
as well as the currently open thread.

### Verified evidence

In the actual reported thread, `065af0fb-1e86-44f5-a569-fd626f655df0` ("Spectacular send button
animation polish"), turn `019fa3c0…` exists in `projection_turns` as completed at
`2026-07-27T13:26:32.577Z` with a ready checkpoint. Event sequence `95170` sets the completed turn
pointer; later sequence `95313` clears it through the ready `thread.session-set`.

### Secondary client-side defects

Two independent client behaviors would still weaken the treatment after the projection is fixed:

- `ChatView.tsx` marks the open thread visited on every `serverThread.updatedAt`, including the
  completion update. This passively acknowledges finished work without a thread click.
- `resolveSidebarV2RowSurfaceClassName` intentionally gives the active-row surface precedence over
  unread completion, so an active-and-unread row cannot receive the perimeter glow.

### Repair and focused coverage

- Preserve the existing completed-turn pointer when a non-running session reports
  `activeTurnId: null`; a running non-null active turn should still replace it.
- A visit baseline should advance on explicit route/thread engagement, not every passive server
  update.
- Combine active and unread-completion styling instead of suppressing the branded ring for the
  active row.
- Add a projection regression covering `running → turn-diff-completed → ready`, a client lifecycle
  test proving completion remains unread until explicit activation, and a sidebar style test for
  active plus unread completion.

---

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

# 🔴 **A COMPANION JOB THAT OUTLIVES A SERVER RESTART STRANDS ITS AGENT CARD FOREVER**

## **STATUS: NOT FIXED. Repair script exists. Root cause is still live.**

Observed 2026-07-27. A `codex:codex-rescue` card sat at `running` with a live-ticking timer for
40+ minutes after its Codex job had already finished. Survived a UI reload, a hard reload, and a
full app close/reopen.

## Symptom

An agent card renders `running` indefinitely. The elapsed timer keeps counting. The card's activity
line is frozen at some earlier moment while the underlying job log kept advancing past it. Reloading
and restarting the app do not clear it — they are the two things guaranteed _not_ to work.

## Root cause

The per-thread agent roster is carried **latest-wins in the payload of an `agent.snapshot` thread
activity** (`packages/contracts/src/threadAgents.ts`). It is an ordinary persisted row, so the UI
rebuilds from it on every reload and every cold start.

Only a _newer_ snapshot carrying a terminal status (`completed | failed | stopped`, see
`THREAD_AGENT_TERMINAL_STATUSES` at `packages/contracts/src/threadAgents.ts:41`) clears the card.
The thing that emits that snapshot is the companion watcher fiber in
`ClaudeAdapter.ts:2619` — and **nothing rehydrates it.** `startCompanionWatcher`
(`ClaudeAdapter.ts:2636`) only runs when a launch line is observed live.

So: server dies while a job is being watched → fiber dies with it → job finishes later with nothing
alive to emit the terminal snapshot → the last non-terminal snapshot stays authoritative forever.

`COMPANION_WATCH_LIMIT_MS` (2h, `ClaudeAdapter.ts:114`) is the only backstop, and it lives inside the
very process that died.

### Observed timeline

| Time (local) | Event                                                               |
| ------------ | ------------------------------------------------------------------- |
| 18:25:32     | Last `agent.snapshot` written — agent still `running`, no `endedAt` |
| 18:25:33     | App process restarts — **watcher fiber dies one second later**      |
| 18:31:34     | Codex job `task-ms37sqhu-ffd21e` completes successfully             |
| —            | No watcher alive. No terminal snapshot ever written.                |

The timer ticks because the entry has `status: "running"`, no `endedAt`, and a `currentActivity`
string; the client counts from `firstStartedAt` against the wall clock. Clearing `status` alone is
not enough — `currentActivity` and `phaseTitle` must also be dropped or the running line persists.

## Repair (data only — does NOT fix the bug)

```bash
# Close V3 Code first. --force writes against a live app at the risk of the
# server re-emitting its in-memory roster over the correction.
node scripts/fix-stuck-agent-cards.mjs                    # dry run
node scripts/fix-stuck-agent-cards.mjs --apply            # backs up the DB, appends corrected snapshot
node scripts/fix-stuck-agent-cards.mjs --stale-minutes 30 # default threshold is 15
```

Scans every thread's latest snapshot, settles only agents idle beyond the threshold, refuses to
touch anything still plausibly live.

### The repair alone is NOT enough — hydration is lazy

Writing the corrected snapshot fixes the database but **does not change the UI**, and neither a
renderer reload nor a full cold restart will pick it up. `ProviderRuntimeIngestion.ts:1658` only
re-reads the roster when `eventTouchesAgents || activityPressure` — an agent-touching event, or
`AGENT_SNAPSHOT_REFRESH_ACTIVITY_COUNT` (400) activities since the last snapshot. A freshly started
server has not hydrated either, so it keeps serving its boot-time roster.

**After running the repair, spawn any trivial subagent.** That is the cheapest trigger: the server
hydrates from the corrected snapshot, emits a fresh one, and the card settles live over the
WebSocket with no restart.

This cost several wasted debugging cycles — the data was verifiably correct (right revision, decodes
cleanly, wins the selection) while the UI stayed wrong, because nothing had asked the server to look
at it. If the card still reads `running` after a repair, do not re-verify the data; trigger a
hydration.

## Where to fix

| Area                         | Path                                                    |
| ---------------------------- | ------------------------------------------------------- |
| Watcher lifecycle            | `apps/server/src/provider/Layers/ClaudeAdapter.ts:2619` |
| Watcher start (no rehydrate) | `apps/server/src/provider/Layers/ClaudeAdapter.ts:2636` |
| Job record reader            | `apps/server/src/provider/codexCompanionJobs.ts:196`    |
| Roster contract              | `packages/contracts/src/threadAgents.ts:41`             |

**Strongly recommended:** a startup reconciliation that re-attaches watchers for jobs whose records
are still non-terminal, and settles any roster entry whose job record is already terminal or whose
process is gone. Same shape as the reconciliation recommended for the interrupted-turn wedge above —
it turns a permanent stranding into a self-healing one.

## Adjacent hazard — `cancel` can kill an unrelated process

The same missing liveness check bites harder in the plugin's cancel path. The job record stores a
`pid`; cancel issues `taskkill /PID <pid> /T /F` **without verifying the process is still the job it
started**. After the job dies, the OS recycles the PID — in the observed case onto
`scripts/v3-electron-dev.mjs`, the user's own Electron dev stack. `/T` kills the whole tree.

It only failed to fire because Git Bash mangled `/PID` into `C:/Program Files/Git/PID` (MSYS path
conversion). Run the same cancel from PowerShell and it would have taken down the dev stack.

Lives in the plugin (`codex-companion.mjs`), not this repo, but any fix here should assume a stale
`pid` is never safe to trust.

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
