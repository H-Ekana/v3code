# Task: Fix "Claude workflow agents stay `active` after the workflow has completed" (KNOWN-ISSUES.md 🟠)

You are an implementation agent working in the shared checkout at
`C:\Users\Hritwik\Documents\GitHub\v3code`. Read `AGENTS.md` and the
"CLAUDE WORKFLOW AGENTS STAY ACTIVE AFTER THE WORKFLOW HAS COMPLETED" entry in `KNOWN-ISSUES.md`
before writing any code.

## Problem (observed and confirmed; root cause needs a short trace, then fix)

A completed Claude `Workflow` run kept rendering `12 running · 49 settled · Σ 1.9M tok` with every
card `active` at an identical elapsed time, 18+ minutes after every process had exited — and this
survives leaving and reopening the thread. The last persisted workflow-progress state describes the
child agents as non-terminal, and rehydration revives that stale frame even though completion
results exist (`journal.jsonl` contains final results for the "running" agents — internally
contradictory state).

Same family as the stranded companion card (non-terminal status stays authoritative because its
emitter died), but a DIFFERENT subsystem: the workflow-progress persistence → thread hydration →
workflow-panel reducer path.

## Required invariant

Once a workflow has returned, or every child has a terminal result recorded, reopening the thread
must materialize every child as terminal and must never revive the last `running` progress frame.
The footer counts must agree with the cards. A frozen/identical elapsed time across all cards must
be impossible for a hydrated-terminal workflow.

## Scope and file ownership

First, trace the terminal workflow update path: where workflow progress frames are persisted,
how thread hydration replays them, and where the client panel reduces them. You own:

- The workflow-progress/workflow-panel client files you identify under `apps/web/src`.
- Any server-side workflow-progress persistence/projection files you identify, EXCEPT the files
  listed below.

DO NOT touch (other agents own these concurrently, or they hold uncommitted Phase 1 work you must
not disturb): `apps/server/src/provider/Layers/ClaudeAdapter.ts`,
`apps/server/src/provider/codexCompanionJobs.ts`,
`apps/server/src/provider/Layers/ProviderRuntimeIngestion.ts`,
`packages/contracts/src/threadAgents.ts`, `apps/server/src/orchestration/decider.ts`,
`apps/server/src/orchestration/projector.ts`,
`apps/server/src/provider/Layers/ProviderService.ts`,
`apps/server/src/orchestration/Layers/ProjectionPipeline.ts`,
`apps/web/src/components/ChatView.tsx`, `apps/web/src/components/ChatView.logic.ts`,
`apps/web/src/components/Sidebar.logic.ts`, `apps/web/src/hooks/useThreadActions.ts`.
If the correct fix genuinely requires editing one of these, STOP that part and report the exact
change needed instead of making it.

## Required changes

1. On hydration, reconcile workflow child statuses against recorded terminal results: a child with
   a recorded final result (or a workflow with a recorded return) must materialize as terminal.
2. Apply a settlement policy for a hydrated workflow whose progress frame is non-terminal but whose
   source is provably dead (no live task backing it) — settle it rather than showing `active`.
3. Make elapsed-time labels honest: never tick a live timer for a hydrated, settled, or
   source-dead entry.

## Deliverables (report these back as raw data in your final message)

1. The traced path: file:line for persistence, hydration, and the panel reducer — as raw data.
2. Exact list of files changed, one-line summary per file.
3. Focused tests: (a) hydrating a thread whose workflow returned materializes all children
   terminal; (b) a stale non-terminal frame with recorded child results does not revive `running`
   cards; (c) footer counts match card states after hydration.
4. Exact test commands (`vp test run <files>`; if `vp` is not on PATH use
   `./node_modules/.bin/vp`) and pass/fail summaries.
5. End-goal statement: reopening a thread with a finished workflow must show every agent settled
   with static elapsed times and a consistent footer. State whether your tests prove it.

## Hard constraints

- NO `git commit`, NO branches, NO `git stash`/`reset`/`checkout`. The tree holds other agents'
  uncommitted work — do not revert or reformat files outside your scope.
- Do not start dev servers, the Electron app, or any watcher process.
- Focused tests only; never repo-wide suites. Do not edit `.repos/`.
- `apps/web/src/components/chat/ChatComposer.tsx` contains NUL bytes — directory-wide ripgrep
  silently skips it; pass `--text` or explicit paths when searching `apps/web/src/components/chat/`.
