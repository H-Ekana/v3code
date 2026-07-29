# Known Issues

> **2026-07-29 bulk-fix sweep.** Eight entries in this file were fixed across three phases by
> delegated Codex agents (gpt-5.6-sol, high effort) orchestrated from a Claude session. All fixes
> are **uncommitted in the working tree** and require an app build to reach the installed client.
> Every fix was independently re-verified by the orchestrator: **471 tests across the 17 touched
> suites pass together.** Dispatch briefs and raw agent reports are preserved in `.codex-briefs/`.
>
> Full-sweep audit command (all fixed issues at once):
>
> ```sh
> ./node_modules/.bin/vp test run \
>   apps/server/src/orchestration/decider.settled.test.ts \
>   apps/server/src/orchestration/projector.test.ts \
>   apps/server/src/provider/Layers/ProviderService.test.ts \
>   apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts \
>   apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts \
>   apps/web/src/components/ChatView.logic.test.ts \
>   apps/web/src/components/Sidebar.logic.test.ts \
>   apps/web/src/hooks/useThreadActions.test.ts \
>   apps/web/src/session-logic.test.ts \
>   apps/web/src/components/AgentsPanel.test.tsx \
>   apps/web/src/timestampFormat.timezone.test.ts \
>   apps/web/src/components/chat/MessagesTimeline.test.tsx \
>   apps/web/src/components/chat/MessagesTimeline.lifecycle.test.tsx \
>   apps/web/src/components/chat/timelineScrollAnchoring.test.tsx \
>   apps/web/src/components/chat/AgentsLiveStrip.test.tsx \
>   packages/client-runtime/src/state/threadAgents.test.ts \
>   packages/client-runtime/src/state/threads-sync.test.ts
> ```
>
> Installed-app smoke checks still outstanding (automated tests prove the state machines, not the
> rendered app): stop a running turn; delete one of two same-titled threads; let a thread finish
> unopened; restart the app with a live companion job; reopen a long stale thread after reconnect;
> trigger an `AskUserQuestion`, restart, and confirm the questions reappear as plain text.

---

# 🟢 [FIXED 2026-07-29] THREAD DELETION COULD DO NOTHING AFTER THE USER CLICKED `YES`

## Original bug

After confirming **Delete**, the thread could remain in the sidebar with no error. Verified: the
delete command never reached the orchestration backend — no `thread.deleted` event, no command
receipt, `deleted_at` still null. `useThreadActions.ts` awaited client-side cleanup (provider stop,
`terminalEnvironment.close`) **before** dispatching the durable delete, so a stalled cleanup await
silently swallowed the deletion. The server-side `ThreadDeletionReactor` already performs that
cleanup after the tombstone, so the client gating was pure downside.

## Fix

`apps/web/src/hooks/useThreadActions.ts` now dispatches the durable `threadEnvironment.delete`
FIRST; provider-stop/terminal-close are left to
`apps/server/src/orchestration/Layers/ThreadDeletionReactor.ts`. A failed delete surfaces an
actionable retry toast instead of resolving silently. Deletion diagnostics include the provider
name and a short thread-ID suffix so same-title threads are distinguishable.

## How to audit

- Code: `apps/web/src/hooks/useThreadActions.ts` — confirm the delete dispatch is not gated behind
  any awaited cleanup; confirm the failure path shows a toast with provider + ID suffix.
- Tests: `./node_modules/.bin/vp test run apps/web/src/hooks/useThreadActions.test.ts`
  — includes a regression where terminal-close never settles (delete must still dispatch) and one
  where a failed delete surfaces a visible error (toast contains `Codex` and suffix `…7c0e4b2a`).
- App: delete one of two same-titled threads under different providers; the exact row must vanish
  or a failure toast must appear.

---

# 🟢 [FIXED IN SOURCE + REGRESSION LOCKED 2026-07-29 — NEEDS APP BUILD] SUB-AGENT ACTIVITY CLOCKS SHOWED UTC AS LOCAL TIME

## Original bug

The installed build rendered activity times via `entry.at.slice(11, 19)` — raw UTC `HH:mm:ss` with
no conversion and no `UTC` label (5h30m off under IST). Presentation-only; timestamps in the
database were correct.

## Fix

Current source uses `formatTimestamp(entry.at, settings.timestampFormat)`
(`Intl.DateTimeFormat`, renderer-local zone) — see `apps/web/src/components/AgentsPanel.tsx`
(activity feed call site ~line 538). On 2026-07-29 a straggler audit (`rg --text` for
`.slice(11`/`.substring(11`/`.substr(11`/`.split("T")` across `apps/web/src` and
`packages/client-runtime`, including the NUL-byte `ChatComposer.tsx`) found **zero** remaining
ISO-slicing display paths. A permanent timezone regression test was added.

**Shipping requires a new app build** — the installed `app.asar` may still contain the old code.

## How to audit

- Tests: `./node_modules/.bin/vp test run apps/web/src/timestampFormat.timezone.test.ts`
  — forces `Asia/Kolkata`; proves `2026-07-28T12:53:08.906Z` renders `18:23:08` (never raw
  `12:53:08`) and that durations stay durations (`30m`), not wall-clock labels.
- Code: re-run the straggler grep above (with `--text`!) — must stay at zero hits.
- App (post-build): compare an agent activity time against the Windows clock under IST.

---

# 🟢 [FIXED 2026-07-29] OPENING AN EXISTING CHAT COULD REPLAY ITS ENTIRE HISTORY AS LIVE ACTIVITY

## Original bug (intermittent, now explained)

Selecting a thread sometimes replayed the conversation chronologically as if live — sub-agents
visibly re-ran lifecycles, one-shot animations re-fired — before settling. Diagnosed 2026-07-29:

- A warm cache seeds its resume cursor correctly
  (`packages/client-runtime/src/state/threads.ts` ~142), and the server streams every persisted
  event after that cursor **individually** (`apps/server/src/ws.ts` ~1414).
- Each catch-up event previously passed through the normal reducer AND was published to React on
  the 16 ms live-update window → a long gap replayed as a ~60 FPS time-lapse.
- Intermittent because only a **stale warm cache or reconnect gap** has anything to replay; cold
  loads receive one collapsed snapshot. No cursor-zero bug exists (resume uses `afterSequence`,
  ~372, with sequence dedup ~275).

## Fix

- `packages/client-runtime/src/state/threads.ts` (~295): persisted catch-up is reduced
  immediately but **publication to React is deferred until the `synchronized` marker**; only
  post-marker events use the coalesced live window.
- `apps/web/src/components/chat/MessagesTimeline.logic.ts` (~668) + `MessagesTimeline.tsx`:
  explicit `initialHydration` guard — catch-up resets one-shot lifecycle state instead of being
  interpreted as arrivals.
- `apps/web/src/components/chat/AgentsLiveStrip.tsx`: hydrated rosters render without the live
  pulse until sync commits.
- `apps/web/src/components/ChatView.tsx` (~1618): hydration boundary derived from thread
  synchronization status + thread identity.

## How to audit

- Tests: `./node_modules/.bin/vp test run packages/client-runtime/src/state/threads-sync.test.ts
apps/web/src/components/chat/MessagesTimeline.lifecycle.test.tsx
apps/web/src/components/chat/AgentsLiveStrip.test.tsx` — key regressions:
  long incrementally-supplied history never takes the arrival path; persisted resume events
  collapse and sub-cursor replay is ignored; a genuinely new post-hydration message still animates.
- Invariant to check in code: nothing between the resume-stream handler and React publication may
  publish per-event before the sync marker commits.
- App: reconnect, open a long stale thread — it must appear immediately settled; send a message —
  only that new activity animates.

---

# 🟢 [FIXED 2026-07-29] CLAUDE STRUCTURED QUESTION COULD VANISH WHILE THE TURN STAYED RUNNING

## Original bug

An `AskUserQuestion` was ingested and persisted end-to-end (`user-input.requested` event, complete
activity row, `pending_user_input_count = 1`) but the question card never rendered; the turn
blocked forever and later messages queued invisibly. Two defects: (1) the client did not derive a
persisted pending-input activity into a card on hydration; (2) `ClaudeAdapter.ts` keeps answer
callbacks in an in-memory `pendingUserInputs` map, so after a restart the persisted request was
unanswerable — and re-emitting the old card would be unsafe.

## Fix (explicit-expiry policy)

- `apps/web/src/session-logic.ts` (~417) + `apps/web/src/components/ChatView.tsx` (~2270): a
  persisted unanswered request now always derives into a rendered question card on hydration
  (including degenerate payloads: empty options, missing descriptions), with responding-state
  tracked correctly.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` (~724): **projection bootstrap is
  the restart boundary** — on startup it expires pending Claude requests whose callbacks died with
  the previous process: settles the pending-input activity, persists the original questions as
  visible assistant text, zeroes the pending count, and marks the blocked turn/session
  interrupted. Idempotent.
- `apps/server/src/provider/Layers/ClaudeAdapter.ts` (~4652): responding to an unknown/expired
  request ID returns actionable recovery guidance instead of a bare failure.
- Rationale: the callback exists only in memory and cannot be reconstructed; an interactive card
  must never outlive its callback.

## How to audit

- Tests: `./node_modules/.bin/vp test run apps/web/src/session-logic.test.ts
apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts
apps/server/src/provider/Layers/ClaudeAdapter.test.ts` — covers hydration rendering, restart
  expiry (visible recovery text, zero pending count, interrupted state, idempotence), and
  unknown-request guidance.
- Invariant: grep ProjectionPipeline for the bootstrap expiry (`isStalePendingUserInputFailureDetail`,
  `deriveOpenPendingUserInputActivities`) and confirm it runs on startup, not only on new events.
- App: trigger a structured question, restart the app — the questions must reappear as plain
  assistant text with the turn settled; answering stale state must produce a visible error.

---

# 🟠 [ROOT CAUSE FOUND 2026-07-29; IN-REPO DETECTION FIXED; PLUGIN FIX PENDING UPSTREAM] A DELEGATED CODEX JOB CAN BE KILLED MID-RUN BY CLAUDE SESSION TEARDOWN

## Root cause (confirmed — this was the "silently interrupted" mystery)

Detached companion jobs are **OS-detached but not lifecycle-detached**. In plugin v1.0.6:

- `codex-companion.mjs::spawnDetachedTaskWorker` correctly uses `detached: true`,
  `stdio: "ignore"`, `unref()`.
- But `session-lifecycle-hook.mjs::cleanupSessionJobs` runs at Claude **SessionEnd**, selects every
  job tagged with the ending session, calls `terminateProcessTree(job.pid)`, and **removes the
  record from state** — after `handleSessionEnd` has already shut down the broker
  (`appClient.close()`), which can abort the active turn.

So ending/restarting a Claude session executes its background jobs. Broker shutdown explains
rollouts with an explicit `turn_aborted: interrupted`; worker-tree termination explains rollouts
that simply stop with no terminal marker. A controlled experiment confirmed a properly detached
Node child survives launcher death — ordinary OS teardown is ruled out. No evidence of
`/codex:cancel` involvement. (Evidence note: the 2026-07-29 kill left NO `turn_aborted` line —
the rollout ends abruptly at a `token_count` event; two adjacent child-job rollouts from the same
day do contain explicit `interrupted` records. Both kill shapes are real.)

### Independently verified 2026-07-29 (second, blind Codex agent) — with corrections

A separate agent re-derived the root cause from plugin source knowing only the claim. Verdict:
**substantially correct**, with these precision fixes (file:line refs are into the installed
plugin at `~/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/`):

- `cleanupSessionJobs` (`session-lifecycle-hook.mjs:42`) calls `terminateProcessTree` only for
  `queued`/`running` jobs, but deletes EVERY record of the ending session — and `saveState`
  (`lib/state.mjs:92`) also deletes the per-job JSON and log files. Removal is more destructive
  than "dropped from the list".
- SessionEnd order (`session-lifecycle-hook.mjs:83`): `sendBrokerShutdown` →
  `cleanupSessionJobs` (kill workers) → `teardownBrokerSession` (kill broker PID + artifacts) →
  `clearBrokerSession`. The hook waits only for the broker's shutdown ACK, which the broker sends
  BEFORE closing the app-server (`app-server-broker.mjs:160`), so app-server close and worker
  kill can overlap.
- Workers ride the workspace's shared broker on the NORMAL path (`lib/app-server.mjs:335`,
  `lib/codex.mjs:613`) — but fall back to a worker-owned direct app-server when the broker is
  busy/missing (`lib/codex.mjs:620`). Dependency, not invariant.
- Broker shutdown closes the direct app-server client, which on Windows force-kills the
  app-server tree after 50 ms (`lib/app-server.mjs:232`) — sufficient to kill an in-flight turn.
- Latent hang hazard: `captureTurn` (`lib/codex.mjs:559`) waits only for terminal notifications
  and does not tie the broker socket's death to its completion promise — if the app-server dies
  mid-turn, a SURVIVING worker can hang forever instead of failing cleanly.
- A naive "skip the kill + skip `sendBrokerShutdown`" patch is INSUFFICIENT:
  `teardownBrokerSession` kills the broker PID anyway, and `clearBrokerSession` orphans it. All
  three broker teardown steps must be guarded — and even then: no explicit `background` flag
  exists on job records (only the presence of a stored `request` distinguishes them,
  `codex-companion.mjs:684`), surviving jobs are invisible to session-filtered `/codex:status`
  (`lib/job-control.mjs:15`; explicit `/codex:status <job-id>` still works, `:242`), finished
  workers never shut the broker down (orphaned `codex app-server`s), a crashed worker leaves
  permanent `running` state (no liveness reconciliation), and state writes are unlocked
  read-modify-write (`lib/state.mjs:118`).

## In-repo hardening (fixed, tested)

- `apps/server/src/provider/codexCompanionJobs.ts` (~463): correlates job records with their
  rollout transcripts; incrementally detects `turn_aborted`; distinguishes job-local silence from
  unrelated state writes; probes PIDs read-only (never kills).
- `apps/server/src/provider/Layers/ClaudeAdapter.ts` (~2609): rollout aborts, vanished records,
  and dead/stale workers become **failed agent cards with an explicit reason** plus an
  `[automated]` failure message into the thread. Restart reconciliation is never silent.
- Detection latency: next rollout/vanish poll; ~30 s for a confirmed-dead PID with stale
  artifacts; finite stale fallback otherwise. Indefinite silence is no longer possible.

## Plugin-side fix still required (recommendation, file upstream against plugin v1.0.6)

The verified design (supersedes the naive two-part patch):

1. Persist explicit `background: true` + runtime-ownership metadata on background job records —
   do not infer background-ness from the stored `request`.
2. Give each detached background worker its OWN direct app-server (or dedicated per-job broker)
   instead of the ending Claude session's shared broker; sanitize inherited broker env vars.
3. `cleanupSessionJobs`: preserve active detached-background records and worker PIDs at
   SessionEnd; shut the session broker down normally. If the shared-broker architecture must
   stay, use leases/refcounting — SessionEnd releases the session's lease, each worker holds one
   released in `finally`, broker exits after an idle grace period, and the "anything active?"
   check must be workspace-scoped, not session-scoped.
4. Never delete non-terminal job records (or their JSON/logs) during teardown; mark explicit
   cancellations terminal with `errorMessage`.
5. Make surviving detached jobs visible from later sessions (dedicated "detached jobs" section in
   status; today only explicit `/codex:status <job-id>` crosses sessions).
6. Add PID-liveness reconciliation (dead PID ⇒ `queued/running` → `failed`) and tie the broker
   socket's death into `captureTurn`'s completion promise so a worker fails cleanly instead of
   hanging when the app-server dies mid-turn.
7. Store a worker token + process creation time; verify both before any `terminateProcessTree`
   (stale/recycled-PID hazard — see the cancel note under the companion-card entry).

### Local stopgap APPLIED to the installed plugin (2026-07-29, verified)

The cleaner stopgap is applied to the installed copy at
`~/.claude/plugins/cache/openai-codex/codex/1.0.6/` (six files edited:
`scripts/codex-companion.mjs`, `scripts/session-lifecycle-hook.mjs`, `scripts/lib/codex.mjs`,
`scripts/lib/job-control.mjs`, `scripts/lib/process.mjs`, `scripts/lib/render.mjs`; byte-identical
pre-edit backups alongside as `*.orig` — restoring them is the full revert). What it does:
explicit `background: true` on job records; workers get broker env vars stripped and force a
direct worker-owned app-server (`disableBroker`), so SessionEnd broker teardown proceeds
unchanged and cannot cut a worker's transport; SessionEnd preserves active background PIDs,
records, JSON, and logs; status gains a "Detached jobs (other sessions)" section plus dead/stale
reconciliation (dead PID ⇒ `failed` with reason, record retained); `captureTurn` races transport
death so a worker fails in seconds instead of hanging; cancel refuses to kill a PID whose
identity (creation time/command line) cannot be positively verified; and the
spawn-before-record-write enqueue race got a bounded worker-side retry (that race stranded a real
job as permanently-`queued` earlier the same day).

Verified end-to-end through the installed launcher/worker/hook/state-store/status paths with a
controlled app-server stub: survival across a real SessionEnd hook invocation, cross-session
visibility, dead-PID reconciliation, mid-turn app-server death failing closed (1.8 s), and
cancel-refusal on unverifiable identity. The one caveat: the real Codex runtime could not run in
the patch job's sandbox, so a live-runtime survival run is still worth doing once convenient.
**A plugin update to any newer version silently reverts all of this** — if delegated jobs start
dying at session restarts again, check the `*.orig` files still have patched siblings before
re-diagnosing.

### 📌 TODO — package the fixed plugin WITH v3code (the durable completion of this issue)

The stopgap above is deliberately fragile. This entry is not fully closed until the patched
plugin ships with the repo so it cannot be silently reverted and needs no separate install.
Decided approach (2026-07-29):

1. Fork `openai/codex-plugin-cc` on GitHub (`H-Ekana`) as the canonical home of the fix; land the
   verified 7-point design there; file the upstream PR from the fork.
2. Vendor a snapshot of the patched plugin into this repo (e.g. `vendor/claude-plugins/codex/`)
   with a repo-local marketplace manifest (`vendor/claude-plugins/.claude-plugin/marketplace.json`
   pointing at the local path), and enable it via the checked-in `.claude/settings.json`
   (marketplace + `enabledPlugins`) so opening the repo auto-provides the plugin, version-pinned
   by commit. Keep it synced via the existing `vpr sync:repos` mechanism.
3. Cutover checklist: uninstall the upstream `codex@openai-codex` install on each machine
   (two installs would double-register the SessionEnd hook and `/codex:*` skills), and do it
   while no detached jobs are running — the job state store is keyed by plugin+marketplace
   identity, so a re-identified install starts a fresh store and orphans in-flight jobs.
4. Then delete the cache-patch stopgap note above and mark this entry fully fixed.

Any future issue-sweep that finds this TODO unfinished should treat it as open work even if the
stopgap is currently holding.

## How to audit

- Tests: `./node_modules/.bin/vp test run apps/server/src/provider/codexCompanionJobs.test.ts
apps/server/src/provider/Layers/ClaudeAdapter.test.ts` — proves `turn_aborted`, vanished jobs,
  and dead/stale workers surface as failures with reasons in both card and thread.
- Until the plugin ships its fix: assume any Claude session restart may still kill that session's
  live companion jobs — but the kill now becomes a visible failure instead of silence.
- Recovery of killed work is unchanged: the rollout transcript
  (`~/.codex/sessions/<Y>/<M>/<D>/rollout-*.jsonl`) preserves every `function_call`/output and
  `agent_message`; find it by grepping for a distinctive phrase from the dispatched brief (the job
  id is NOT in the transcript). The job store is
  `~/.claude/plugins/data/codex-openai-codex/state/<workspace-hash>/state.json`; `startedAt` is
  UTC; a stored `pid` is never trustworthy.

---

# 🟢 [FIXED 2026-07-29] NEWLY COMPLETED THREAD LOST ITS `DONE` BADGE AND UNSEEN-COMPLETION GLOW

## Original bug

A just-finished, never-reopened thread fell straight to the muted idle row. Root cause chain:
`thread.turn-diff-completed` set `projection_threads.latest_turn_id`; a later ready
`thread.session-set` with `activeTurnId: null` blindly overwrote it in `ProjectionPipeline.ts`;
`hasUnseenCompletion` then saw `latestTurn: null` and bailed. Two client accomplices: `ChatView`
marked the open thread visited on every passive `serverThread.updatedAt`, and
`resolveSidebarV2RowSurfaceClassName` let the active-row surface suppress the unread glow.

## Fix

- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` (~887): a NON-running session
  reporting `activeTurnId: null` preserves the existing completed-turn pointer; a running session
  with a non-null turn still replaces it.
- `apps/web/src/components/ChatView.tsx` (~2056) + `ChatView.logic.ts` (~31): visit baseline
  advances only on explicit route/thread engagement.
- `apps/web/src/components/Sidebar.logic.ts` (~465): unread-completion glow is additive with the
  active-row surface; state readable from the check + `Done` label, not color alone.

## How to audit

- Tests: `./node_modules/.bin/vp test run
apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts
apps/web/src/components/ChatView.logic.test.ts apps/web/src/components/Sidebar.logic.test.ts`
  — includes the `running → turn-diff-completed → ready` pointer-survival regression, the
  passive-update-stays-unread lifecycle test, and the active+unread combined-style test.
- App: let a background thread finish without clicking it — `Done` check + glow must persist until
  you open it.

---

# [FIXED 2026-07-27] PARENT CODEX OUTPUT DISAPPEARS AFTER A SUB-AGENT INTERACTS WITH `/root`

Codex emitted `subAgentActivity` targeting the parent at `agentPath: "/root"`;
`CodexSessionRuntime.rememberSubAgentActivity` registered the parent as a child, diverting all
later parent notifications into synthetic `collab/agentActivity` events (840 lost assistant deltas
in the verified thread). Fixed in `apps/server/src/provider/Layers/CodexSessionRuntime.ts`: bare
`/root`/canonical-thread registration refused, stale root entries self-heal, canonical thread can
never take the child path. Regression coverage in `CodexSessionRuntime.test.ts`. Missing messages
remain recoverable from the matching `~/.codex/sessions/.../rollout-*.jsonl`.

---

# 🟢 [FIXED 2026-07-29] INTERRUPTED TURNS WEDGED THE THREAD FOREVER

## Original bug (a primary reason this fork exists)

Pressing stop settled `projection_turns` (`interrupted`, `completed_at` set) but left
`projection_thread_sessions` (`running`, `active_turn_id` set) and `provider_session_runtime`
(`running`) stale. The UI reads the session row → permanent `Working for Nh`, dead stop button.
Measured correlation was absolute: 3/3 interrupted turns wedged; 0/189 completed, 0/2 error.

## Fix

- `apps/server/src/orchestration/decider.ts` (~826): interrupting a live session emits a terminal
  `thread.session-set` — clears `activeTurnId`, status `interrupted` — matching the
  completed/error paths.
- `apps/server/src/provider/Layers/ProviderService.ts` (~228): settles runtime state after
  interrupt AND performs **startup reconciliation**: any session whose `active_turn_id` points at
  an already-settled turn (`completed | error | interrupted`) is cleared transactionally, with a
  liveness recheck so a genuinely running turn is never touched. Historical wedges self-heal on
  next launch.

## How to audit

- Tests: `./node_modules/.bin/vp test run apps/server/src/orchestration/decider.settled.test.ts
apps/server/src/orchestration/projector.test.ts
apps/server/src/provider/Layers/ProviderService.test.ts` — interrupt emits the terminal session
  event; projection clears the active turn; cold-start reconciliation clears stale rows and leaves
  live rows alone.
- DB spot-check after an interrupt: the three tables must agree (no `running` session/runtime row
  pointing at a settled turn).
- `scripts/fix-stuck-threads.mjs` remains as a data-repair tool for old databases, but the startup
  reconciliation should make it unnecessary. Handoff doc:
  `docs/project/stuck-thread-bug-handoff.md`.
- App: press stop mid-turn — the header must settle promptly.

---

# 🟢 [FIXED 2026-07-29] A COMPANION JOB THAT OUTLIVED A SERVER RESTART STRANDED ITS AGENT CARD FOREVER

## Original bug

The roster is latest-wins via persisted `agent.snapshot` activities
(`packages/contracts/src/threadAgents.ts`; terminal statuses ~41). Only the companion watcher
fiber emits the terminal snapshot, and nothing rehydrated it after a server restart — so a job
finishing post-restart left the last `running` snapshot authoritative forever (live-ticking timer,
survives reloads and cold starts). The 2 h watch limit lived inside the dead process.

## Fix

- `apps/server/src/provider/Layers/ClaudeAdapter.ts`: watcher correlations are **persisted** and
  **restored during session startup** — a still-non-terminal job gets its watcher re-attached (no
  launch line needed); a terminal job emits its terminal snapshot; a job **vanished** from the
  state store is surfaced as `failed` with an explicit reason. Stored PIDs are never trusted or
  killed; liveness is corroborated via job records/log mtimes.
- `apps/server/src/provider/codexCompanionJobs.ts`: reads the capped `state.json`, per-job
  records/log mtimes, durable watcher registrations; omission from a valid store = vanished.
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`: terminal settlement clears
  `currentActivity` AND `phaseTitle` (status alone left the running line). Reconciliation emits an
  agent-touching event, so hydration happens immediately — the old "spawn a dummy subagent to
  trigger hydration" workaround is obsolete.

Correction to older evidence: the "8-entry cap" was the status _display_ default; the persistent
store caps at 50 (upstream plugin source).

## How to audit

- Tests: `./node_modules/.bin/vp test run apps/server/src/provider/codexCompanionJobs.test.ts
apps/server/src/provider/Layers/ClaudeAdapter.test.ts
apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts` — restart reattachment,
  continued watching, terminal settlement, vanished-job failure, bogus-PID tolerance, and the
  cleared-`phaseTitle` snapshot shape.
- App: restart the app while a companion job runs; after it finishes, the card must settle by
  itself. `scripts/fix-stuck-agent-cards.mjs` remains as a legacy data repair.

## ⚠️ Still-live adjacent hazard — plugin `cancel` can kill an unrelated process

`codex-companion.mjs` cancel issues `taskkill /PID <pid> /T /F` without verifying the PID still
belongs to the job; recycled PIDs make this a loaded gun (it once targeted the Electron dev
stack and only misfired due to MSYS path mangling). Plugin-side; covered by recommendation #6 in
the session-teardown entry above. Until fixed: never `/codex:cancel` a job you suspect is dead.

---

# 🟢 FIXED — Codex root thread appeared as its own sub-agent

`CodexAdapter` derived an agent nickname from the last `agentPath` segment, so the bare `/root`
parent became a sub-agent named `root` (own replies as "sub-agent activity", 22.9M-token roster
entry). Fixed by requiring path depth >= 2; `/root/root` still resolves. Regression test asserts
bare `/root` emits nothing.

---

# 🟢 [ADDRESSED 2026-07-29 — server follow-ups remain] AGENTS PANEL WAS PROVIDER-BLIND FOR DETACHED JOBS

## Original gap and what closed it

A rescue card went green in ~30 s while the real detached job ran invisibly. Two rounds of work
closed most of it: the server now tails detached jobs and replays progress onto the forwarder's
card, re-pinning it to `running` until the job settles (`codexCompanionJobs.ts`; see AGENTS.md),
and on 2026-07-29 the client slice landed:

- `apps/web/src/components/AgentsPanel.tsx` (~90): lifecycle labeling — **Launching job** →
  **Detached job** — live phase/activity with local timestamps, detached provenance retained
  after settling, and truthful **Usage unavailable** instead of wrapper tokens.
- `packages/client-runtime/src/state/threadAgents.ts` (~229): detects handed-off companion rows
  and excludes wrapper tokens from footer totals.

## Remaining gaps (recommendations, server-owned)

1. Make job ownership authoritative immediately at correlation (suppress the wrapper's
   `task.completed` instead of re-pinning after it) — a transient wrapper-completion race remains.
2. Propagate the companion record's true `startedAt` so elapsed time starts at job launch, not
   watcher attach.
3. Move detached watching into a provider-neutral runtime (currently Claude-adapter-specific).
4. Installed-app smoke verification of launch → handoff → restart → terminal.
5. Real Codex usage is not exposed by the companion; "Usage unavailable" is honest but a data gap.

Related, still open: Claude sub-agents emit a sparser activity feed than Codex ones
(`task_progress` coarse summaries vs per-item events). Roadmap: `docs/project/ideal-agents-sidebar.md`.

## How to audit

- Tests: `./node_modules/.bin/vp test run apps/web/src/components/AgentsPanel.test.tsx
packages/client-runtime/src/state/threadAgents.test.ts` — launch → detached → settled lifecycle,
  phase/activity rendering, wrapper-token exclusion (ordinary usage still counted).
- App: dispatch a rescue job and watch the card through the full lifecycle; it must never show
  green-and-done while the detached job still runs.

---

# 🟢 [FIXED 2026-07-29] CLAUDE WORKFLOW AGENTS STAYED `active` AFTER THE WORKFLOW COMPLETED

## Original bug

A finished `Workflow` run rendered all children `active` with **identical elapsed times** and a
stale footer (`12 running · Σ 1.9M tok`) long after every process exited, surviving thread
reopen. (Identical timers were the diagnostic tell — staggered live agents can't tie.) Root cause:
`deriveLatestAgentSnapshot` in `packages/client-runtime/src/state/threadAgents.ts` selected only
the highest-revision `agent.snapshot` and ignored matching persisted `task.completed` activities,
so the last running frame stayed authoritative on rehydration.

## Fix

- `packages/client-runtime/src/state/threadAgents.ts` (~48, ~113, ~282): hydration reconciles
  children against recorded terminal task results, rejects results from older activations, and
  settles source-dead workflow children; footer counts derive from the reconciled states.
- `apps/web/src/components/AgentsPanel.tsx` (~275): settled/end-marked entries never start live
  elapsed timers.

## How to audit

- Tests: `./node_modules/.bin/vp test run packages/client-runtime/src/state/threadAgents.test.ts
apps/web/src/components/AgentsPanel.test.tsx` — returned-workflow materializes all children
  terminal; a stale non-terminal frame with recorded results cannot revive `running` cards;
  footer matches card states; settled timers are static.
- App: reopen a thread with a completed workflow — zero running agents, static durations,
  consistent footer. Note `Σ tok` is spend-to-date, not a rate. Completed `agent()` results
  remain recoverable from the run's `journal.jsonl` regardless.
