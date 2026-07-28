# Known Issues

# 🟠 **CONFIRMED THREAD DELETION CAN DO NOTHING AFTER THE USER CLICKS `YES`**

## **STATUS: CONFIRMED, NOT FIXED. The failed deletion did not reach the database.**

After choosing **Delete** from a thread's context menu and approving the native confirmation dialog,
the thread can remain in the sidebar with no visible error. This is not always a stale client row:
in the confirmed reproduction, the delete command never reached the orchestration backend.

### Verified reproduction

Two stopped threads had the identical title **"Categorize and split dirty commits"**:

| Provider | Thread ID                              | Database state after deleting the GPT row |
| -------- | -------------------------------------- | ----------------------------------------- |
| Codex    | `542eab66-3463-4987-9bbb-e61f7c0e4b2a` | `deleted_at = null`                       |
| Claude   | `9786f3ea-69f9-4cb8-9b45-4648634d11dc` | `deleted_at = null`                       |

The user selected the Codex/GPT row and clicked **Yes** in the confirmation dialog. A live,
read-only inspection immediately afterwards found:

- the Codex row still present in `projection_threads` with `deleted_at = null`;
- no `thread.deleted` event for that thread;
- no new entry in `orchestration_command_receipts` for that thread; and
- its projected provider session already in `stopped`, with no active turn or error.

Therefore this instance was not a successful database deletion that the sidebar failed to render.
The orchestration service never received `thread.delete`.

### Most likely failure boundary

`apps/web/src/hooks/useThreadActions.ts` does several awaited cleanup steps before it dispatches the
durable delete command:

1. optionally stop the provider session;
2. await `terminalEnvironment.close`;
3. only then dispatch `threadEnvironment.delete`.

For this reproduction there was no linked worktree and the session was already stopped. That leaves
the awaited terminal-close command as the only normal asynchronous step between confirmation and
the missing delete dispatch. A stalled or interrupted terminal-close request is therefore the
strongest current lead, although client-side tracing is still needed to prove it.

The ordering is especially suspicious because
`apps/server/src/orchestration/Layers/ThreadDeletionReactor.ts` already stops the provider session
and closes thread terminals after a durable `thread.deleted` event. Client-side cleanup before the
tombstone duplicates that responsibility and creates a point where deletion can silently stop
halfway.

Identical titles made the incident harder to inspect, but they are not themselves sufficient to
explain the failure: commands are scoped by environment and thread ID, not title.

### Expected behavior

Once the user confirms, the app must either persist `thread.deleted` and remove the exact selected
thread, or show an actionable failure. A cleanup request must never leave the operation silently
unfinished.

### Investigation and fix direction

- Add phase-level tracing keyed by environment ID and thread ID for confirmation, provider stop,
  terminal close, delete dispatch, command receipt, and projection update.
- Add a regression test where terminal close never settles or is interrupted; the durable delete
  must still be dispatched.
- Prefer dispatching `thread.delete` first and leaving provider/terminal cleanup to the existing
  server-side deletion reactor. If client pre-cleanup remains necessary, make it bounded and
  best-effort rather than a prerequisite.
- Do not silently suppress an interrupted delete operation. Surface a failure and keep enough
  context for a retry.
- Include the provider name and a short thread-ID suffix in deletion diagnostics so same-title
  threads can be distinguished unambiguously.

---

# 🟡 **SUB-AGENT ACTIVITY CLOCKS CAN SHOW UTC AS IF IT WERE LOCAL TIME**

## **STATUS: CONFIRMED IN THE INSTALLED BUILD. FIX EXISTS IN CURRENT SOURCE BUT HAS NOT REACHED THAT BUILD.**

Times displayed inside sub-agent tool calls can be exactly 5 hours 30 minutes behind the Windows
clock when the computer is using India Standard Time. This is a presentation bug, not clock drift
and not corrupted database timestamps.

### Verified evidence

- Windows reported `2026-07-28 18:28:36 +05:30` in the `India Standard Time` zone.
- A persisted activity timestamp was `2026-07-28T12:53:08.906Z`. The trailing `Z` means UTC, so its
  correct local value is `18:23:08.906 IST`.
- The installed Agents panel showed the UTC clock portion instead of applying the `+05:30` offset.
- A nearby test process independently printed a local start time of `18:22`, agreeing with the
  converted event time and confirming that the system and provider clocks were aligned.

### Root cause

The installed client bundle renders activity times with the equivalent of:

```ts
entry.at.slice(11, 19);
```

That extracts the `HH:mm:ss` text directly from the ISO UTC timestamp. It does not convert the
instant into the renderer's local time zone, but the result is presented without a `UTC` label, so
it looks like an incorrect local clock.

The current source in `apps/web/src/components/AgentsPanel.tsx` already uses
`formatTimestamp(entry.at, settings.timestampFormat)`. The shared formatter uses
`Intl.DateTimeFormat`, which converts the instant into the renderer's local time zone. The installed
`app.asar` still contains the older substring implementation, so the correction requires an app
build containing the current source.

### Expected behavior and regression coverage

- Never display a wall-clock timestamp by slicing an ISO string.
- Use the shared timestamp formatter for every Agents panel and tool-call time.
- Keep elapsed durations distinct from wall-clock times.
- Add a regression test under a non-UTC time zone, such as `Asia/Kolkata`, proving that a `Z`
  timestamp is rendered with the local offset.
- If UTC is ever intentionally displayed, label it explicitly as `UTC`.

---

# 🟠 **OPENING AN EXISTING CHAT CAN REPLAY ITS ENTIRE HISTORY AS LIVE ACTIVITY**

## **STATUS: INTERMITTENTLY OBSERVED, NOT YET DIAGNOSED.**

Sometimes selecting an existing chat does not hydrate directly into its current persisted state.
Instead, the interface appears to replay the thread chronologically from its beginning before finally
settling on the present:

- the user's earliest messages appear first;
- assistant messages and tool activity advance through their original sequence;
- sub-agents visibly repeat their complete lifecycles, including starting, working, changing status,
  and finishing; and
- after the historical sequence finishes, the thread returns to its actual current state.

The effect resembles a time-lapse or "time warp" through the conversation. Historical events are
presented as if they were arriving live, even though every event was already persisted with its
original timestamp.

### Expected behavior

Opening a chat should immediately hydrate its latest materialized state. Existing messages should
render as static history, and each sub-agent should appear only in its latest persisted state.
Animations, status transitions, notifications, and completion effects should run only for events
received after the live subscription begins.

### Impact

- Old agents appear to start working again, which falsely suggests live backend activity.
- Long threads can produce substantial visual churn, delay, and CPU usage before becoming usable.
- One-shot arrival and completion animations may replay when they should remain acknowledged.
- The user cannot reliably distinguish historical playback from new work.

### Investigation leads

The failure is likely at the snapshot-to-live-stream boundary. Investigate whether:

- initial thread hydration dispatches persisted events individually through the same reducer path as
  new WebSocket events;
- a reconnect or thread selection subscribes from sequence zero instead of the latest hydrated
  cursor;
- historical `agent.snapshot` activities are applied one by one instead of collapsing directly to
  the latest roster; or
- transition and animation logic lacks an explicit `initialHydration` guard.

Capture the affected thread ID, selection timestamp, whether the app had just reconnected, event
sequence/cursor values, and a performance trace when reproducing. The important invariant is:
**hydrate history once, then animate only genuinely new events.**

---

# 🔴 **CLAUDE STRUCTURED QUESTION CAN VANISH WHILE THE TURN STAYS RUNNING**

## **STATUS: CONFIRMED, NOT FIXED. Live request may be recoverable without restarting.**

A Claude `AskUserQuestion` call can be accepted and persisted correctly while its question card never
appears in the composer. Ordinary messages sent afterwards are stored and forwarded to Claude's queue,
but they cannot run because the current provider call is still blocked waiting for the structured
answer. The user sees a permanent `Working` timer and messages that appear to disappear.

### Verified evidence

Thread `fe577358-c5a6-415b-b180-f9a76d0f6f70` ("Research update-capable installer"), Claude session
`df06d083-8720-455f-a884-416930998889`, request
`0e3fa3dc-eccf-4116-aac8-9a2ef5c173a1`:

- Claude's raw JSONL ends at an `AskUserQuestion` tool call containing two complete questions.
- `orchestration_events` contains the matching `user-input.requested` activity.
- `projection_thread_activities` contains the complete request and all options.
- `projection_threads.pending_user_input_count` is `1`.
- Both later "Hey are you stuck?" messages exist in `projection_thread_messages`.
- Claude recorded two `queue-operation: enqueue` entries for those messages.
- The turn and both session tables still report `running`.

This isolates the failure after provider ingestion and persistence: the client did not hydrate or
render a valid pending-input activity. It is not message loss and it is not an actively thinking
model.

### Why restart recovery is special

The structured request payload is durable, but the function that can answer it is not.
`ClaudeAdapter.ts` keeps pending `AskUserQuestion` callbacks in its in-memory `pendingUserInputs`
map. A server/app restart can therefore leave a perfectly preserved question card whose request ID
no longer has a live callback. Re-emitting that old card after restart is unsafe: submitting it can
only fail with `Unknown pending user-input request`.

### Recovery

1. **Before restarting**, submit `thread.user-input.respond` directly with the preserved request ID.
   If the adapter still owns the callback, Claude continues from the exact blocked position and then
   drains the queued messages.
2. If the provider reports an unknown/stale request, close V3 Code, back up the database, settle the
   stale pending-input activity, interrupt the wedged turn, and restore the questions as ordinary
   visible assistant text. Reopen the app and answer them in a fresh turn.
3. Never recreate an interactive question card using a request ID whose live callback is gone.

### Where to fix

| Area                              | Path                                                                    |
| --------------------------------- | ----------------------------------------------------------------------- |
| Claude pending callback lifecycle | `apps/server/src/provider/Layers/ClaudeAdapter.ts`                      |
| Pending-input projection          | `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`            |
| Client derivation and rendering   | `apps/web/src/session-logic.ts`, `apps/web/src/components/ChatView.tsx` |

The durable fix needs both client hydration coverage and a restart policy: either rehydrate a
provider-answerable callback, or explicitly expire the persisted request and prompt the user again.

---

# 🔴 **A DELEGATED CODEX JOB CAN BE SILENTLY INTERRUPTED MID-RUN AND REPORT NOTHING**

## **STATUS: CONFIRMED, ROOT CAUSE UNKNOWN. Observed three times on 2026-07-27. Work is recoverable.**

A `codex:codex-rescue` sub-agent launches a detached job, the job runs real work for several minutes,
and is then **cancelled by something outside itself**. The parent session is never told. There is no
error, no failed card, no output — the delegation simply never comes back, and the caller is left
waiting indefinitely on a job that died.

This is distinct from the companion-job stranding issue further down. There, the job _finishes_ and
the card is stranded. Here the job is _killed_ and the result is destroyed.

## Symptom

- The rescue subagent returns `launched successfully` with a job id in ~25s. **This is meaningless.**
  The forwarder reports that the job started, not that it will finish.
- Nothing further ever arrives. No `[automated]` turn input, no failure, no card transition.
- Waiting longer does not help. The job is already dead by the time you start wondering.

## Verified evidence — three runs, same day

Jobs 1 and 2 were dispatched from session `887fbf7d-ebfa-4f69-8f2e-afb59a9c5913` on a read-only
research brief. Job 3 came from a different session (`18a5e029-ed9d-4c55-a44e-eca707a99096`) on a
**write** brief — the motion-foundation slice of the interaction-polish plan. All three used
`--model gpt-5.6-sol --effort high`.

|                            | Job 1                  | Job 2 (relaunch of the same brief) | Job 3 (different session, write task) |
| -------------------------- | ---------------------- | ---------------------------------- | ------------------------------------- |
| Job id                     | `task-ms3hzjly-pwjmgj` | `task-ms3ibzhi-1fm9ff`             | `task-ms3k0p9e-suby04`                |
| Started (local)            | 22:55:33               | 23:05:13                           | 23:52:19                              |
| Tool calls completed       | **44**                 | **66**                             | **43**                                |
| `agent_message` narrations | 3                      | 2                                  | 7                                     |
| Ended                      | `turn_aborted`         | `turn_aborted`                     | `turn_aborted`                        |
| `reason`                   | `interrupted`          | `interrupted`                      | `interrupted`                         |
| Ran for                    | 335.6s (~5m36s)        | 520.2s (~8m40s)                    | 1186.9s (~19m47s)                     |
| Delivered to parent        | **nothing**            | **nothing**                        | **nothing**                           |

Aborted turn ids: `019fa49c-646d-7cd3-b42a-5b4f616f71c4`, `019fa4a5-4238-7b90-a3ca-806811642abc`,
and `019fa4d0-7c82-7a10-a74e-015dd30e7ef2`.

**The three durations — 5m36s, 8m40s, 19m47s — rule out a fixed timeout or deadline.** Whatever
cancels these fires on an event, not a clock. Tool-call count is not the trigger either: job 3 died
after _fewer_ calls (43) than job 1, which survived 44.

### What job 3 adds

- **Write work survives; the report does not.** Jobs 1–2 were read-only research, so an abort
  destroyed everything. Job 3's file edits were already on disk, so the slice was recoverable — but
  it died mid-verification and left a **failing test** (`ui/card.test.tsx` still asserted the inline
  focus classes it had just replaced with the `motion-focus` recipe). An aborted write job can
  therefore leave the tree red with no signal that anything is wrong.
- **Detection is manual.** `codex-companion.mjs status` kept reporting `running` / `verifying` with
  `updatedAt` frozen at the last log line. The only reliable tell was that the elapsed time had
  outgrown the command cadence — every previous command took 0.4s–35s, and the last one had been
  "running" for 21 minutes. `Get-Process -Id <pid>` then confirmed the process was gone.
- Job 3 aborted at 18:42:21Z, **9 seconds after** its last command started (18:42:12Z) and 17s after
  the previous one completed cleanly. The abort lands mid-command, not at a turn boundary.

**Do not `/codex:cancel` a job you suspect is already dead** — see the stale-`pid` hazard below. The
PID has likely been recycled onto an unrelated process, and cancel kills the whole process tree.

`reason: "interrupted"` is the same reason code a user pressing stop produces. Nobody pressed stop.
Something in the delegation path is issuing a cancel, or dropping a connection that Codex interprets
as one.

## Where the work actually survives

**The transcripts are complete and on disk.** This is the single most useful fact in this entry.

```
~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ISO-timestamp>-<uuid>.jsonl
```

For the two runs above:

```
rollout-2026-07-27T22-55-33-019fa49c-33ea-71b1-bf30-3f68f5d21b3a.jsonl   (816 KB, 193 lines)
rollout-2026-07-27T23-05-13-019fa4a5-106b-7c60-a017-f53b82b659e3.jsonl   (1.0 MB, 281 lines)
```

Each line is JSON with a `payload.type`. What you get, and what you do not:

| `payload.type`         | Recoverable? | Contains                                                                    |
| ---------------------- | ------------ | --------------------------------------------------------------------------- |
| `function_call`        | ✅           | every command the agent ran, with full arguments                            |
| `function_call_output` | ✅           | the full output it saw — file contents, grep hits, everything               |
| `agent_message`        | ✅           | the agent's narration to the user; usually carries its headline conclusions |
| `user_message`         | ✅           | the dispatched prompt — use this to identify _which_ rollout is yours       |
| `turn_aborted`         | ✅           | `reason`, `turn_id`, `started_at`, `completed_at`, `duration_ms`            |
| `reasoning`            | ❌           | `summary` is an empty array and `encrypted_content` is opaque               |

So the agent's **evidence and stated conclusions survive; its private deliberation does not.** In
practice the `agent_message` entries plus the `function_call_output` bodies were enough to reconstruct
the substantive findings of both runs, including answers the interrupted agents had already reached
but never got to report.

### Recovery procedure

Identify the rollout by grepping for a distinctive phrase from the prompt you dispatched — the job id
is **not** in the transcript, so it cannot be used to find the file:

```powershell
rg -l "some distinctive phrase from your brief" $env:USERPROFILE\.codex\sessions\2026\07\27
```

Then extract narration and outcome without loading the whole file:

```powershell
Get-Content $f | ForEach-Object {
  try { $o = $_ | ConvertFrom-Json } catch { return }
  if ($o.payload.type -eq 'agent_message') { "=== $($o.payload.message)" }
  elseif ($o.payload.type -eq 'turn_aborted') { "=== ABORTED: $($o.payload.reason) after $([int]($o.payload.duration_ms/1000))s" }
}
```

Pair `function_call` with `function_call_output` **by index** (they alternate 1:1) and truncate each
body, or a single read will blow out the context of whoever is doing the recovery.

## Where the job record lives — and a trap

The record is **not** in any `%TEMP%\codex-jobs-*`, `%TEMP%\codex-companion\*`, or
`%TEMP%\codex-plugin-*` directory. Those exist, are populated, and are _stale decoys_. The live store
is:

```
~/.claude/plugins/data/codex-openai-codex/state/<workspace-hash>/state.json
```

Searching the temp directories instead produced a confident, wrong conclusion that the first job had
"never registered" — when in fact it was running at that moment. **Check this file first.**

Two further traps in that file:

- **`startedAt` is UTC while the app and process list are local.** A job stamped
  `2026-07-27T18:23:58Z` started at `23:53:58` local (IST, +5:30). Mistaking this for a five-hour-old
  job makes a live job look abandoned.
- **The job list is capped (8 entries observed) and both interrupted jobs were absent from it
  afterwards**, even though older _completed_ jobs from earlier the same day survived. One of them had
  been directly observed in that file as `"status": "running", "pid": 46996` while it was alive. So an
  interrupted job appears to be removed rather than marked failed — leaving no on-disk trace that it
  ever ran. **The rollout transcript is then the only record.**

The store also carries `running` entries whose pids are long dead (observed: `34528`, `28900`), the
same stale-liveness weakness described in the companion-job entry below. A `pid` in this file is never
safe to trust.

## Impact

- ~110 tool calls of paid research were discarded across the two runs.
- The caller had no way to know. Both jobs were reported as successfully launched and then simply went
  quiet, which is indistinguishable from "still working" for an unbounded period.
- Any conclusion drawn from a delegated job that "never came back" is suspect: the job may have found
  the answer and been killed before it could say so. In this instance the interrupted runs had already
  produced findings that **overturned the plan built from the run that did succeed**.

## Diagnosis leads (none confirmed)

- Different durations rule out a fixed timeout.
- The broker process for job 2 (`node`, pid `28000`, spawned with the job at 23:05:07) was dead
  shortly after, and its `%TEMP%\cxc-*` working directory had been removed. Whether the broker dying
  causes the interrupt or is a consequence of it is unknown.
- `reason: "interrupted"` is a cancellation code, not a crash or a resource failure. Something sends
  it. The cancel path in the plugin is a candidate, especially given it is already known (below) to act
  on unverified pids.
- Not a credits/usage-limit failure — that surfaces as an explicit limit message or an
  `app-server connection closed` at startup, and produces no tool calls at all.

## Where to look

| Area                            | Path                                                    |
| ------------------------------- | ------------------------------------------------------- |
| Rescue forwarder / job dispatch | `codex-companion.mjs` (plugin, not this repo)           |
| Job record reader               | `apps/server/src/provider/codexCompanionJobs.ts:196`    |
| Companion watcher lifecycle     | `apps/server/src/provider/Layers/ClaudeAdapter.ts:2619` |

**Strongly recommended:** treat a job that vanishes from the state store without a terminal status as a
failure and surface it to the caller. Silence is currently indistinguishable from progress, which is the
core defect — the same "the panel lies about who is working" failure this fork exists to fix.

---

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

---

# 🟠 **CLAUDE WORKFLOW AGENTS STAY `active` AFTER THE WORKFLOW HAS COMPLETED**

## **STATUS: CONFIRMED, NOT FIXED. Cosmetic, but it misreports token spend as ongoing.**

Observed 2026-07-28. A Claude `Workflow` run (`wf_ae2c3275-7c1`, 12 diagnostic agents) rendered
`12 running · 49 settled · Σ 1.9M tok` in the workflow panel roughly **18 minutes after every process
involved had exited**. A later reproduction showed the same twelve cards labeled `active`, each at
exactly `66m 9s`, while the footer still reported `12 running · 49 settled · Σ 1.9M tok`. The user
reasonably read this as "the workflow is still running and burning my usage limit".

This survives leaving and reopening the thread. Completion results exist, but the last persisted
workflow-progress state continues to describe the diagnostic agents as non-terminal.

Same family as _"A companion job that outlives a server restart strands its agent card forever"_
above — a non-terminal status stays authoritative because the thing that would emit the terminal
status died with the run — but a **different subsystem and a different tell**, so it is filed
separately.

## How to tell it apart from a genuinely live run

The distinguishing symptom is that **every agent shows the identical elapsed time** — first all
twelve read `33m 7s`, and a later rendering showed all twelve at `66m 9s`. That is diagnostic:

- The stranded-agent-card bug above ticks **live** (client counts `firstStartedAt` against the wall
  clock). A workflow panel may preserve a frozen progress frame or recompute its elapsed label after
  hydration, but it still preserves the stale non-terminal statuses.
- Agents that really are running were started staggered and would show _different_ elapsed times.
  Twelve identical timers cannot be twelve live processes.

## Evidence used to confirm death (all four agree, and all are cheap)

1. **No file has been written since the run ended.** Newest file in the workflow transcript dir was
   `10:27:49`; `journal.jsonl` last written `10:26:45`; checked at `10:45:37` — 18 minutes silent. A
   live agent writes to its `agent-<id>.jsonl` continuously.
2. **No process exists.** The only long-lived `node` was from the _previous day_; everything else
   post-dated the check and belonged to the checking session itself.
3. **`TaskList` returns nothing.**
4. **Internally contradictory state.** `journal.jsonl` contains recorded _final results_ for 11 of
   the 12 agents the panel claims are `running`. An agent cannot both have returned and still be
   running.

## Practical consequences

- **`Σ tok` is a total already spent, not a rate.** A stale panel does not mean tokens are still
  accruing.
- Do not "stop" a run on the panel's word alone. Check mtimes in the transcript dir first — if it has
  been quiet for minutes, there is nothing to stop and `TaskStop` will report failure on an
  already-dead task, which reads alarmingly and is meaningless.
- Results are **not** lost when this happens. `journal.jsonl` holds each completed `agent()` call's
  return value and can be read directly:

```bash
node -e "
const fs=require('fs');
const lines=fs.readFileSync('journal.jsonl','utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
for (const d of lines.filter(o=>o.result!==undefined)) console.log(d.agentId, JSON.stringify(d.result).slice(0,200));
"
```

Recovering a stopped run this way is what produced
`docs/project/nightly-motion-polish-diagnosis.md` — 11 of 12 agents' findings survived the run being
killed.

## Investigation target

Trace the terminal workflow update from Claude's completed `Workflow` result through persistence,
thread hydration, and the workflow-panel reducer. The required invariant is: once a workflow has
returned or every child has a terminal result, reopening the thread must materialize every child as
terminal and must never revive the last `running` progress frame.
