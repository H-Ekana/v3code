# Task: Fix "Interrupted turns wedge the thread forever" (KNOWN-ISSUES.md 🔴)

You are an implementation agent working in the shared checkout at
`C:\Users\Hritwik\Documents\GitHub\v3code`. Read `AGENTS.md` and the
"INTERRUPTED TURNS WEDGE THE THREAD FOREVER" entry in `KNOWN-ISSUES.md` before writing any code.

## Root cause (already diagnosed — do not re-litigate)

When a turn is interrupted (user presses stop), `projection_turns` settles correctly
(`state = interrupted`, `completed_at` set), but two rows go stale:

- `projection_thread_sessions`: `status` stays `running`, `active_turn_id` stays set.
- `provider_session_runtime`: `status` stays `running`.

The UI reads the session row, so the thread shows `Working for Nh` forever and stop no-ops.
Completed and error turns clear these correctly; ONLY the interrupt path misses it.
`apps/server/src/orchestration/projector.test.ts` (~lines 293-324) already asserts
`activeTurnId: "turn-1"` → `null` for the working path — the mechanism exists.

Full handoff brief: `docs/project/stuck-thread-bug-handoff.md` — read it.

## Scope and file ownership (do NOT edit outside this)

- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/projector.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- Their test files, plus any new test file you add under the same directories.

Other agents are concurrently editing `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
and `apps/web/src/hooks/useThreadActions.ts` — do not touch those files or their tests.

## Required changes

1. Make the interrupt/stop path settle the session exactly like the completed/error paths:
   when a turn transitions to `interrupted`, clear `projection_thread_sessions.active_turn_id`,
   set its `status` out of `running`, and settle `provider_session_runtime.status`.
2. Add a startup reconciliation: on server start, clear any session row whose `active_turn_id`
   points at a turn that is already settled (`completed | error | interrupted`). It must refuse to
   touch a session whose active turn is genuinely live. This turns any historical wedge into a
   self-healing one.

## Deliverables (report these back as raw data in your final message)

1. Exact list of files changed, with a one-line summary per file of what changed and why.
2. New/extended focused tests: an interrupt-path projection test proving session + runtime rows
   settle, and a reconciliation test covering (a) stale row cleared, (b) live row untouched.
3. The exact test commands you ran (use `vp test run <test-files>` — focused only, NEVER the full
   suite) and their pass/fail output summaries.
4. Any behavior you observed that contradicts the KNOWN-ISSUES diagnosis.
5. User-observable end goal statement: after this fix, pressing stop must settle the header
   (no permanent `Working for Nh`), and restarting the server must self-heal any pre-existing
   wedged thread. Say explicitly whether your tests prove each of these.

## Hard constraints

- NO `git commit`, NO branches, NO `git stash`/`reset`/`checkout` — the pre-commit hook can
  destroy other agents' concurrent work (see AGENTS.md). Leave all changes uncommitted.
- Do not start dev servers, the Electron app, or any watcher.
- Do not run repo-wide `vp check` / `vp run test` / `vp run typecheck`. Focused checks only.
- Do not edit files under `.repos/`.
