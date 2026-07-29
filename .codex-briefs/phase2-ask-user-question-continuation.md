# Task: COMPLETE the partially-finished AskUserQuestion fix (continuation of an interrupted job)

A previous Codex agent (session `019facbf-73fd-72e0-911c-9dc5a3e37723`, transcript at
`~/.codex/sessions/2026/07/29/rollout-2026-07-29T12-50-56-019facbf-*.jsonl`) was working the brief
at `.codex-briefs/phase2-vanishing-ask-user-question.md` and was KILLED mid-run at 13:02 local.
Read that original brief in full first — its scope, ownership boundaries, and hard constraints all
still apply verbatim (no commits, no branches, no stash/reset, focused tests only, no app launch).

## What the interrupted agent already did (verified still on disk, parses, current tests pass)

- Chose the **explicit expiry policy**: the server's projection bootstrap is the restart boundary —
  it settles durable unanswered Claude user-input requests after in-memory callbacks are gone,
  persists an assistant message containing the original questions, and marks the blocked turn
  interrupted. The client treats the expiry as terminal.
- Edited `apps/web/src/session-logic.ts` + `apps/web/src/session-logic.test.ts` (hydration
  derivation of persisted pending-input activities; 82 test lines added; suite passes).
- Edited `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — it was writing a patch here
  (adding `isStalePendingUserInputFailureDetail`, `deriveOpenPendingUserInputActivities`, EventId/
  MessageId imports) at the moment it died. The file parses and its existing test suite passes,
  but the expiry-bootstrap work is likely INCOMPLETE.
- Some edits to `apps/server/src/provider/Layers/ClaudeAdapter.ts` and
  `apps/web/src/components/ChatView.tsx`.

## Your job

1. `git diff` the four files above to see the current state; read the interrupted agent's
   transcript narration if helpful.
2. Complete the expiry-policy implementation coherently: projection bootstrap settles stale pending
   requests, surfaces the questions as visible assistant text, marks the wedged turn interrupted;
   client renders persisted pending-input cards on hydration; answering an unknown/expired request
   surfaces an actionable error; never render an interactive card with no live callback.
3. Deliver the original brief's full deliverables list: files changed, the three regression tests
   ((a) hydration renders the card, (b) restart expires dead-callback requests safely,
   (c) unknown-request response surfaces an error), exact `./node_modules/.bin/vp test run` commands
   with results, policy rationale, end-goal statement.

## Extra caution

The working tree holds verified uncommitted fixes from four other completed agents. Do NOT revert
or reformat anything outside minimal completions of this task. The files you own already contain
that other work (ClaudeAdapter watcher reconciliation, ProjectionPipeline latest-turn guard,
ChatView visit-baseline) — preserve it.
