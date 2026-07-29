# Task: Implement the verified "cleaner stopgap" in the INSTALLED Codex plugin (v1.0.6)

You are modifying the installed Codex Claude Code plugin at
`C:\Users\Hritwik\.claude\plugins\cache\openai-codex\codex\1.0.6\` — NOT the v3code repo. The user
has explicitly approved editing the installed plugin. First read the entry
"A DELEGATED CODEX JOB CAN BE KILLED MID-RUN BY CLAUDE SESSION TEARDOWN" in
`C:\Users\Hritwik\Documents\GitHub\v3code\KNOWN-ISSUES.md`, especially the
"Independently verified" subsection — it contains the exact file:line map of the mechanism you
are fixing, produced by a blind verification pass. Treat it as ground truth to re-check, not to
re-derive.

## Goal

Background `task` jobs must survive the launching Claude session's SessionEnd/restart, remain
discoverable, and never hang or leak silently. This is a stopgap ahead of a proper fork.

## Extreme caution — you are editing live infrastructure

- YOU are running as a detached job managed by this very plugin. Do not kill any process you did
  not start. Do not truncate or rewrite `state.json`. Do not restructure files — make minimal,
  surgical edits.
- Before ANY edit: copy each file you will touch to `<name>.orig` alongside it (e.g.
  `session-lifecycle-hook.mjs.orig`). List the backups in your report. This is the revert path.
- Check the workspace state stores for currently-running jobs before and after your work; you
  must not disturb them.

## Required changes (the verified design, stopgap scope)

1. **Explicit background metadata.** In `codex-companion.mjs::enqueueBackgroundTask` (job record
   creation, ~684) persist `background: true` on the job record. Everywhere background-ness is
   currently inferred from the stored `request`, prefer the flag with the old inference as
   fallback for pre-existing records.
2. **Worker-owned app-server.** Make the detached task worker's turn execution
   (`codex-companion.mjs` worker entry ~838 → `executeTaskRun` ~461 → `runAppServerTurn` →
   `lib/codex.mjs::withAppServer` ~613/1095) bypass the session's shared broker: force the
   direct app-server path (the `disableBroker`-style connection option that already exists in
   `lib/app-server.mjs::~335` connection selection) for background workers, and sanitize the
   inherited broker endpoint env vars in the spawned worker's environment
   (`spawnDetachedTaskWorker`, ~671/673) so it cannot silently reattach to the session broker.
3. **SessionEnd preserves background jobs.** In `session-lifecycle-hook.mjs::cleanupSessionJobs`
   (~42): skip `terminateProcessTree` AND record/file deletion for jobs with `background: true`
   that are `queued`/`running`. Terminal background records may still be cleaned. Because
   background workers no longer use the shared broker (change 2), the broker teardown sequence
   (`sendBrokerShutdown` → `teardownBrokerSession` → `clearBrokerSession`, ~83) can proceed
   UNCHANGED — verify this reasoning against the code and say so explicitly in your report.
4. **Cross-session visibility.** In `lib/job-control.mjs` (~15/213): include surviving
   `background: true` jobs from other sessions in status output, clearly labeled (e.g. a
   "detached jobs (other sessions)" section). Explicit `<job-id>` lookup already crosses
   sessions (~242) — keep that.
5. **Liveness reconciliation + safe cancel.** Where status reads job records, reconcile: a
   `queued/running` job whose PID is dead and whose artifacts are stale becomes `failed` with an
   `errorMessage` (never delete the record/logs). In the cancel path
   (`codex-companion.mjs` ~963, `lib/codex.mjs` ~960, `lib/process.mjs::terminateProcessTree`
   ~57): before killing, verify the PID still belongs to the expected process (match process
   creation time and/or command line via PowerShell `Get-CimInstance Win32_Process`); refuse and
   report if it does not match.
6. **Hang fix.** In `lib/codex.mjs::captureTurn` (~559): tie transport/app-server death into the
   completion promise so a worker whose app-server dies mid-turn fails cleanly with a terminal
   record instead of hanging forever.

If any of these turns out to be architecturally infeasible as a surgical edit, implement the rest
and report exactly why, with the code evidence.

## Verification (required, end-to-end)

The plugin has no test suite; verify by experiment in a THROWAWAY workspace (a temp dir, its own
state store — never the live v3code workspace state):

1. Launch a trivial background task job (`node codex-companion.mjs task --background --cwd <tmp>
--model gpt-5.6-sol --effort low "Return exactly: STOPGAP-SURVIVAL-TEST"`).
2. While it runs, invoke `session-lifecycle-hook.mjs` the way Claude would at SessionEnd for that
   synthetic session (feed the hook its expected stdin/env; read the hook to construct this).
3. Prove: the worker survives, completes, and writes its terminal record; the broker teardown
   still ran; status from a DIFFERENT synthetic session shows the surviving/finished job under
   the detached section.
4. Also prove the liveness path: fabricate a `running` record with a dead PID in the throwaway
   store and show status reconciles it to `failed` without deleting it.
5. Syntax-check every edited file (`node --check`). Clean up all throwaway state and processes.
6. If sandboxing blocks the Codex runtime in the throwaway workspace (SQLite init failure was
   observed before), fall back to a stub worker script that exercises the same
   spawn/kill/preserve paths, and say clearly which parts were proven end-to-end vs by stub.

## Deliverables (raw data)

1. Backups created (paths), files edited, per-file one-line summary with line refs.
2. For change 3: your explicit verification that broker teardown is safe to leave unchanged given
   change 2.
3. Experiment transcript: commands, observed process/record states at each step, pass/fail per
   invariant above.
4. Anything you found that contradicts the KNOWN-ISSUES analysis.
5. A short "revert procedure" (restore `.orig` files) and a note on which plugin version this
   patch applies to (1.0.6, gitCommitSha db52e28f4d9ded852ab3942cea316258ae4ef346).
6. End-goal statement: a background job now survives Claude session restart, stays visible, and
   dead jobs surface as failed. State what was proven end-to-end.

## Hard constraints

- Do not touch the v3code repository working tree at all (KNOWN-ISSUES.md is read-only context).
- Never kill or cancel processes/jobs you did not create. Never edit `state.json` of the live
  workspace by hand.
- Minimal diffs; no reformatting; preserve the plugin's code style.
