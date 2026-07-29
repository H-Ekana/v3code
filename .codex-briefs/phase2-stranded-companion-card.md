# Task: Fix "A companion job that outlives a server restart strands its agent card forever" (KNOWN-ISSUES.md 🔴)

You are an implementation agent working in the shared checkout at
`C:\Users\Hritwik\Documents\GitHub\v3code`. Read `AGENTS.md` and the
"A COMPANION JOB THAT OUTLIVES A SERVER RESTART STRANDS ITS AGENT CARD FOREVER" entry in
`KNOWN-ISSUES.md` before writing any code.

## Root cause (already diagnosed — do not re-litigate)

The per-thread agent roster is carried latest-wins in `agent.snapshot` thread activities
(`packages/contracts/src/threadAgents.ts`; terminal statuses at line ~41). Only a newer snapshot
with a terminal status (`completed | failed | stopped`) clears a card. The emitter is the companion
watcher fiber in `apps/server/src/provider/Layers/ClaudeAdapter.ts` (~line 2619), and NOTHING
rehydrates it: `startCompanionWatcher` (~2636) only runs when a launch line is observed live. If
the server dies while watching, the job finishes with no watcher alive → the last `running`
snapshot stays authoritative forever. `COMPANION_WATCH_LIMIT_MS` (2h, ~line 114) lives inside the
process that died, so it is no backstop. The job record store is
`~/.claude/plugins/data/codex-openai-codex/state/<workspace-hash>/state.json`, read via
`apps/server/src/provider/codexCompanionJobs.ts` (~line 196).

Also relevant: hydration is lazy — `ProviderRuntimeIngestion.ts` (~line 1658) only re-reads the
roster when an event touches agents or activity pressure hits 400. And a `pid` in the job store is
NEVER safe to trust (PIDs get recycled; the plugin's cancel path has already nearly killed an
unrelated process tree).

## Scope and file ownership (do NOT edit outside this)

- `apps/server/src/provider/Layers/ClaudeAdapter.ts` and its tests.
- `apps/server/src/provider/codexCompanionJobs.ts` and its tests.
- `apps/server/src/provider/Layers/ProviderRuntimeIngestion.ts` and its tests — ONLY if needed to
  make the reconciled snapshot actually reach clients.
- `packages/contracts/src/threadAgents.ts` — ONLY if a contract addition is strictly required;
  keep it schema-only.

Another agent is concurrently editing workflow-panel/workflow-progress files in `apps/web` — do
not touch `apps/web` at all.

## Required changes (the KNOWN-ISSUES entry strongly recommends exactly this)

1. Startup reconciliation for companion watchers:
   - Re-attach a watcher for any job whose record is still non-terminal.
   - Emit a terminal `agent.snapshot` (clearing `status`, `currentActivity`, AND `phaseTitle` —
     clearing status alone leaves the running line) for any roster entry whose job record is
     already terminal or whose job has vanished from the state store.
   - Treat a job that vanished from the capped job list without a terminal status as FAILED and
     surface that — silence must be distinguishable from progress.
2. Never trust a stored `pid` as proof of liveness; corroborate with the job record / log mtimes.
   Do not kill by pid.
3. Ensure the corrected snapshot actually reaches the UI without requiring the user to spawn a
   dummy subagent (the lazy-hydration trap documented in KNOWN-ISSUES).

## Deliverables (report these back as raw data in your final message)

1. Exact list of files changed, one-line summary per file.
2. Focused tests: (a) restart with a non-terminal job record re-attaches a watcher; (b) restart
   with a terminal/vanished job record settles the roster entry (status, currentActivity,
   phaseTitle all cleared); (c) a genuinely live job is left running/watched.
3. Exact test commands (`vp test run <files>` — if `vp` is not on PATH use
   `./node_modules/.bin/vp`) and pass/fail summaries.
4. Anything contradicting the KNOWN-ISSUES diagnosis.
5. End-goal statement: after a server restart, a finished companion job's card must settle on its
   own (no eternal ticking timer, no manual repair script, no dummy-subagent trigger). State
   whether your tests prove it.

## Hard constraints

- NO `git commit`, NO branches, NO `git stash`/`reset`/`checkout`. The working tree already holds
  other agents' uncommitted Phase 1 work — do not revert or reformat files outside your scope.
- Do not start dev servers, the Electron app, or any watcher process.
- Focused tests only; never repo-wide suites. Do not edit `.repos/`.
- `scripts/fix-stuck-agent-cards.mjs` is the data-repair script — leave it working; your fix is
  the root-cause complement, not a replacement.
