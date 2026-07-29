# Task: Diagnose and harden against "A delegated Codex job can be silently interrupted mid-run" (KNOWN-ISSUES.md 🔴)

You are an implementation+investigation agent in the shared checkout at
`C:\Users\Hritwik\Documents\GitHub\v3code`. Read `AGENTS.md` and the
"A DELEGATED CODEX JOB CAN BE SILENTLY INTERRUPTED MID-RUN AND REPORT NOTHING" entry in
`KNOWN-ISSUES.md` first.

## Known facts

- Detached Codex jobs die with `turn_aborted`, `reason: "interrupted"` — a cancellation code, not
  a crash — after variable durations (5m36s / 8m40s / 19m47s on 2026-07-27), ruling out a fixed
  timeout. Nobody pressed stop. The parent session is never told.
- FRESH LEAD (2026-07-29): a `codex exec` job launched as a CHILD of the Claude Code process died
  with `turn_aborted: interrupted` at the exact moment that parent process exited (rollout
  `~/.codex/sessions/2026/07/29/rollout-2026-07-29T12-50-56-019facbf-*.jsonl`, died 07:32:16Z).
  This strongly suggests process-tree teardown (or broker/stdio disconnect on parent exit) sends
  or is interpreted as the cancel. The 07-27 jobs were launched "detached" by the plugin — verify
  how detached they really are (process group, job object, inherited handles, broker stdio).
- The plugin's dispatch path is `codex-companion.mjs` (NOT in this repo — find it under the
  installed codex plugin, likely `~/.claude/plugins/cache/**/codex/**`). Read it; do not edit
  plugin files — propose plugin-side changes as a written recommendation instead.
- Repo-side surfaces: `apps/server/src/provider/codexCompanionJobs.ts` (job records; note it was
  substantially reworked on 2026-07-29 — vanished jobs are now surfaced as failed) and
  `apps/server/src/provider/Layers/ClaudeAdapter.ts` (watcher lifecycle, also freshly reworked).
  Preserve that uncommitted work; build on it, never revert it.

## Your job

1. INVESTIGATE: read the plugin's launch/cancel/broker code and the 07-27 + 07-29 rollout
   evidence. Determine (or narrow to concrete candidates) what issues the interrupt: process-group
   teardown on parent exit, broker process death, stdio/connection drop, or an explicit cancel
   call. Test hypotheses with cheap, safe experiments if possible (e.g. launch a trivial detached
   codex job, kill the launcher, observe whether the job survives) — never touch live user jobs.
2. HARDEN in-repo: whatever the killer is, ensure an interrupted job is DETECTED and SURFACED:
   a job record whose rollout shows `turn_aborted` (or whose process/log goes silent while
   non-terminal) must fail the agent card with a reason, and the failure must reach the thread.
   Extend the 07-29 reconciliation rather than duplicating it.
3. RECOMMEND: a precise written plugin-side fix (file, function, change) for true detachment
   and/or abort reporting.

## Scope and file ownership (do NOT edit outside this)

- `apps/server/src/provider/codexCompanionJobs.ts` + tests
- `apps/server/src/provider/Layers/ClaudeAdapter.ts` + tests
- Plugin files and rollout transcripts: READ ONLY.

Other agents are concurrently editing `apps/web/src/components/chat/MessagesTimeline*`,
`apps/web/src/components/ChatView.tsx`, `apps/web/src/session-logic.ts`,
`apps/web/src/components/AgentsPanel.tsx`, and `packages/client-runtime/src/state/threadAgents.ts`
— do not touch those.

## Deliverables (raw data in your final message)

1. Root-cause finding or ranked candidate list, each with the concrete evidence for/against.
2. Results of any launch/kill experiments (commands, observations).
3. Files changed + one-line summaries; focused tests proving interrupted jobs surface as failures
   with a reason.
4. Exact test commands (`./node_modules/.bin/vp test run <files>`) and results.
5. The written plugin-side recommendation.
6. End-goal statement: a killed job must become a visible failure, never indefinite silence. State
   whether tests prove the in-repo half.

## Hard constraints

- NO `git commit`, NO branches, NO stash/reset/checkout. The tree holds six verified uncommitted
  fixes — preserve them all.
- Do not start dev servers or the app. Do not cancel/kill any live user jobs; `taskkill` only on
  processes you yourself started for experiments.
- Focused tests only. Do not edit `.repos/` or plugin files.
