# Task: Fix "Claude structured question can vanish while the turn stays running" (KNOWN-ISSUES.md 🔴)

You are an implementation agent working in the shared checkout at
`C:\Users\Hritwik\Documents\GitHub\v3code`. Read `AGENTS.md` and the
"CLAUDE STRUCTURED QUESTION CAN VANISH WHILE THE TURN STAYS RUNNING" entry in `KNOWN-ISSUES.md`
before writing any code.

## Problem (confirmed with database evidence — read the entry's evidence table)

A Claude `AskUserQuestion` call is ingested and persisted end-to-end (`user-input.requested` event,
complete activity row with all options, `pending_user_input_count = 1`), yet the question card never
renders in the composer. The turn blocks forever on the unanswered structured question; later user
messages enqueue but cannot run. The failure is isolated AFTER provider ingestion and persistence:
the client did not hydrate or render a valid pending-input activity.

Separately: `ClaudeAdapter.ts` keeps pending `AskUserQuestion` callbacks in an in-memory
`pendingUserInputs` map. After a server/app restart the persisted request survives but the callback
is gone — submitting against it can only fail with `Unknown pending user-input request`.
Re-emitting an old card whose callback is dead is UNSAFE.

## Scope and file ownership (do NOT edit outside this)

- `apps/web/src/session-logic.ts` and its tests — pending-input derivation/hydration.
- `apps/web/src/components/ChatView.tsx` and its tests — rendering of the pending-input card.
  NOTE: this file carries uncommitted work from a previous phase (visit-baseline logic near line
  ~2056 and `ChatView.logic.ts`). Do not revert or reformat it; make minimal additive edits.
- `apps/server/src/provider/Layers/ClaudeAdapter.ts` and its tests — pending-callback lifecycle
  and restart policy. This file also carries fresh uncommitted watcher-reconciliation work from
  another agent; do not revert it.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` and its tests — ONLY if the
  pending-input projection needs a change; this file too holds uncommitted work. Minimal edits.

Do not touch `apps/server/src/provider/codexCompanionJobs.ts`,
`apps/server/src/provider/Layers/ProviderRuntimeIngestion.ts`, workflow-panel files,
`apps/web/src/hooks/useThreadActions.ts`, `apps/web/src/components/Sidebar.logic.ts`, or anything
under `apps/server/src/orchestration/` other than ProjectionPipeline.

## Required changes

1. Client hydration coverage: a persisted, unanswered `user-input.requested` activity (with
   `pending_user_input_count > 0`) must always derive into a rendered question card — including on
   thread selection/hydration long after the event arrived. Find and close the derivation gap in
   `session-logic.ts` / ChatView rendering.
2. Restart policy in `ClaudeAdapter.ts` — pick per the KNOWN-ISSUES guidance: either rehydrate a
   provider-answerable callback for persisted pending requests, or explicitly EXPIRE the persisted
   request on startup (settle the pending-input activity, surface the questions as visible
   assistant text, and let the user answer in a fresh turn). Never render an interactive card whose
   request ID has no live callback.
3. Answering an expired/unknown request must produce a visible, actionable error — not a silent
   failure.

## Deliverables (report these back as raw data in your final message)

1. Exact list of files changed, one-line summary per file.
2. Focused tests: (a) hydrating a thread with a persisted unanswered request renders/derives the
   question card; (b) restart with a dead callback follows your chosen policy (rehydrate OR
   expire+surface) and never leaves an interactive card with no callback; (c) responding to an
   unknown request surfaces an actionable error.
3. Exact test commands (`vp test run <files>`; if `vp` is not on PATH use
   `./node_modules/.bin/vp`) and pass/fail summaries.
4. Which policy you chose (rehydrate vs expire) and why, as one short paragraph.
5. End-goal statement: a structured question can never silently strand a turn — it is either
   answerable or visibly expired with a path forward. State whether your tests prove it.

## Hard constraints

- NO `git commit`, NO branches, NO `git stash`/`reset`/`checkout`. The tree holds several agents'
  uncommitted work — do not revert or reformat files outside (or inside) your scope beyond your
  minimal edits.
- Do not start dev servers, the Electron app, or any watcher process.
- Focused tests only; never repo-wide suites. Do not edit `.repos/`.
- `apps/web/src/components/chat/ChatComposer.tsx` contains NUL bytes — directory-wide ripgrep
  silently skips it; pass `--text` or explicit paths when searching near it.
