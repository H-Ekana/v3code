# Task: Fix "Newly completed thread loses its Done badge and unseen-completion glow" (KNOWN-ISSUES.md 🟣)

You are an implementation agent working in the shared checkout at
`C:\Users\Hritwik\Documents\GitHub\v3code`. Read `AGENTS.md` and the
"NEWLY COMPLETED THREAD CAN LOSE ITS DONE BADGE AND UNSEEN-COMPLETION GLOW" entry in
`KNOWN-ISSUES.md` before writing any code.

## Root cause (already diagnosed down to event sequences — do not re-litigate)

1. `thread.turn-diff-completed` writes the completed turn ID to `projection_threads.latest_turn_id`.
2. A later `thread.session-set` with `status: "ready"`, `activeTurnId: null` arrives.
3. `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` blindly replaces `latest_turn_id`
   with that null.
4. `ProjectionSnapshotQuery` then exposes `latestTurn: null`; `hasUnseenCompletion` returns false;
   no `Done` badge, no glow.

Secondary client defects (fix both):

- `apps/web/src/components/ChatView.tsx` marks the open thread visited on every
  `serverThread.updatedAt`, passively acknowledging completions without a click.
- `resolveSidebarV2RowSurfaceClassName` gives the active-row surface precedence over unread
  completion, so an active-and-unread row can never show the perimeter glow.

## Scope and file ownership (do NOT edit outside this)

- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` and its tests.
- `apps/web/src/components/ChatView.tsx` (visit-baseline logic only) and its tests.
- The file containing `resolveSidebarV2RowSurfaceClassName` (locate it under `apps/web/src`) and
  its tests.

Other agents are concurrently editing `apps/server/src/orchestration/decider.ts`,
`apps/server/src/orchestration/projector.ts`,
`apps/server/src/provider/Layers/ProviderService.ts`, and
`apps/web/src/hooks/useThreadActions.ts` — do not touch those files or their tests.

## Required changes

1. In ProjectionPipeline: preserve the existing completed-turn pointer when a NON-running session
   reports `activeTurnId: null`. A running session with a non-null active turn must still replace it.
2. In ChatView: advance the visit baseline only on explicit route/thread engagement, not on every
   passive server update.
3. In the sidebar styling resolver: combine active + unread-completion styling instead of
   suppressing the completion ring for the active row. The state must be readable from the check
   and `Done` label, not color alone.

## Deliverables (report these back as raw data in your final message)

1. Exact list of files changed, with a one-line summary per file.
2. A projection regression test covering the sequence `running → turn-diff-completed → ready`
   proving `latest_turn_id` survives.
3. A client lifecycle test proving completion remains unread until explicit activation.
4. A sidebar style test for active + unread completion combined.
5. The exact test commands you ran (`vp test run <test-files>` — focused only, NEVER the full
   suite) and their pass/fail output summaries.
6. User-observable end goal statement: a thread that finishes while unopened keeps its themed
   `Done` check and glow until the user opens it; opening acknowledges it. Say explicitly whether
   your tests prove this.

## Hard constraints

- NO `git commit`, NO branches, NO `git stash`/`reset`/`checkout` — the pre-commit hook can
  destroy other agents' concurrent work (see AGENTS.md). Leave all changes uncommitted.
- Do not start dev servers, the Electron app, or any watcher.
- Do not run repo-wide `vp check` / `vp run test` / `vp run typecheck`. Focused checks only.
- Do not edit files under `.repos/`.
- Note: `apps/web/src/components/chat/ChatComposer.tsx` contains NUL bytes that make directory-wide
  ripgrep silently skip it — irrelevant to your scope, but pass explicit paths if you grep near it.
