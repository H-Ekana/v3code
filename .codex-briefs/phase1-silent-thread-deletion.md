# Task: Fix "Thread deletion can do nothing after the user clicks Yes" (KNOWN-ISSUES.md 🟠)

You are an implementation agent working in the shared checkout at
`C:\Users\Hritwik\Documents\GitHub\v3code`. Read `AGENTS.md` and the
"CONFIRMED THREAD DELETION CAN DO NOTHING AFTER THE USER CLICKS YES" entry in `KNOWN-ISSUES.md`
before writing any code.

## Root cause direction (already investigated — follow it)

`apps/web/src/hooks/useThreadActions.ts` performs awaited client-side cleanup BEFORE dispatching
the durable delete command: (1) optionally stop provider session, (2) await
`terminalEnvironment.close`, (3) only then dispatch `threadEnvironment.delete`. In the confirmed
reproduction the delete never reached the orchestration backend — no `thread.deleted` event, no
command receipt. A stalled/interrupted terminal-close await is the strongest lead. Meanwhile
`apps/server/src/orchestration/Layers/ThreadDeletionReactor.ts` ALREADY stops the session and
closes terminals server-side after the durable `thread.deleted` event, so the client pre-cleanup
duplicates that responsibility and creates the silent-halt point.

## Scope and file ownership (do NOT edit outside this)

- `apps/web/src/hooks/useThreadActions.ts` and its test file(s).
- You may READ `apps/server/src/orchestration/Layers/ThreadDeletionReactor.ts` to confirm the
  server-side cleanup coverage, but do not edit server files.

Other agents are concurrently editing `apps/server/src/orchestration/*` and
`apps/web/src/components/ChatView.tsx` — do not touch those files or their tests.

## Required changes

1. Reorder deletion: dispatch the durable `threadEnvironment.delete` FIRST, once the user confirms.
   Leave provider-stop and terminal-close to the server-side ThreadDeletionReactor. If any client
   pre-cleanup must remain, make it bounded (timeout) and best-effort — it must never gate the
   delete dispatch.
2. Never silently swallow a failed/interrupted delete: surface an actionable error to the user and
   keep enough context for a retry.
3. Include the provider name and a short thread-ID suffix in deletion diagnostics/log lines so
   same-title threads are distinguishable.

## Deliverables (report these back as raw data in your final message)

1. Exact list of files changed, with a one-line summary per file.
2. A regression test where the terminal-close (or other pre-cleanup) never settles or rejects —
   proving the durable delete is still dispatched.
3. A test proving a failed delete surfaces an error rather than resolving silently.
4. The exact test commands you ran (`vp test run <test-files>` — focused only, NEVER the full
   suite) and their pass/fail output summaries.
5. User-observable end goal statement: after this fix, confirming Delete must either remove the
   exact selected thread or show an actionable failure — never a silent no-op. Say explicitly
   whether your tests prove this.

## Hard constraints

- NO `git commit`, NO branches, NO `git stash`/`reset`/`checkout` — the pre-commit hook can
  destroy other agents' concurrent work (see AGENTS.md). Leave all changes uncommitted.
- Do not start dev servers, the Electron app, or any watcher.
- Do not run repo-wide `vp check` / `vp run test` / `vp run typecheck`. Focused checks only.
- Do not edit files under `.repos/`.
