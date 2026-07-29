# Task: Diagnose and fix "Opening an existing chat can replay its entire history as live activity" (KNOWN-ISSUES.md 🟠)

You are an implementation+investigation agent in the shared checkout at
`C:\Users\Hritwik\Documents\GitHub\v3code`. Read `AGENTS.md` and the
"OPENING AN EXISTING CHAT CAN REPLAY ITS ENTIRE HISTORY AS LIVE ACTIVITY" entry in
`KNOWN-ISSUES.md` first.

## Problem

Intermittently, selecting an existing thread does not hydrate straight to its persisted state:
messages and tool activity replay chronologically as if arriving live — sub-agents visibly re-run
their lifecycles, animations and completion effects re-fire — before the thread settles. No
reproduction is currently available, so this is a code-path diagnosis: find where the invariant
"hydrate history once, then animate only genuinely new events" can break.

## Investigation leads (from KNOWN-ISSUES — verify each in code)

1. Does initial thread hydration dispatch persisted events INDIVIDUALLY through the same reducer
   path as live WebSocket events (instead of applying a collapsed snapshot)?
2. Can a reconnect or thread selection subscribe from sequence/cursor ZERO instead of the latest
   hydrated cursor? Look hard at the WebSocket subscription setup and any reconnect path.
3. Are historical `agent.snapshot` activities applied one-by-one instead of collapsing to the
   latest roster?
4. Is there an `initialHydration` (or equivalent) guard on transition/animation/notification
   logic? Where is it missing?

## Scope and file ownership (do NOT edit outside this)

- `apps/web/src/components/chat/MessagesTimeline.tsx`, `MessagesTimeline.logic.ts`,
  `MessagesTimeline.test.tsx`, `MessagesTimeline.lifecycle.test.tsx`
- `apps/web/src/components/chat/timelineScrollAnchoring.ts` + test
- `apps/web/src/components/chat/AgentsLiveStrip.tsx` + test
- `apps/web/src/components/ChatView.tsx` and `apps/web/src/session-logic.ts` — MINIMAL additive
  edits only; both carry fresh verified uncommitted work (visit-baseline, pending-input
  hydration). Never revert or reformat them.
- The client WebSocket subscription/cursor code you identify under `apps/web/src` or
  `packages/client-runtime` — EXCEPT `packages/client-runtime/src/state/threadAgents.ts`, which
  another agent owns right now. If the fix needs that file, STOP that part and report the exact
  change needed instead.

Other agents also own `apps/server/src/provider/**` and `apps/web/src/components/AgentsPanel.tsx`
— do not touch.

## Required outcome

1. Identify the concrete mechanism(s) by which history can replay as live — file:line, as raw
   data — even if you cannot reproduce it live.
2. Fix what you find: hydration must apply collapsed state; subscriptions must resume from the
   hydrated cursor; one-shot animations/notifications must be guarded during initial hydration.
3. Regression tests: (a) hydrating a long persisted thread renders statically (no per-event
   animation path taken); (b) a subscription starting below the hydrated cursor does not replay
   already-hydrated events as live; (c) genuinely new post-hydration events still animate.

## Deliverables (raw data in your final message)

1. Diagnosis: mechanism(s) found, with file:line evidence and an explanation of why it is
   intermittent.
2. Files changed + one-line summaries.
3. The three regression tests and exact commands (`./node_modules/.bin/vp test run <files>`) with
   results.
4. End-goal statement: opening a chat hydrates instantly to its current state; only
   post-subscription events animate. State whether tests prove it.

## Hard constraints

- NO `git commit`, NO branches, NO stash/reset/checkout. Preserve all uncommitted work.
- Do not start dev servers or the app.
- Focused tests only. Do not edit `.repos/`.
- `apps/web/src/components/chat/ChatComposer.tsx` contains NUL bytes — directory-wide ripgrep
  silently skips it; use `--text` or explicit paths when searching that directory.
