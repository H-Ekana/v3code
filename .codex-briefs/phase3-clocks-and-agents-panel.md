# Task: (a) Lock in the UTC-clock fix with a regression test; (b) close the provider-blind Agents-panel gap (KNOWN-ISSUES.md 🟡 + 🟡)

You are an implementation agent in the shared checkout at
`C:\Users\Hritwik\Documents\GitHub\v3code`. Read `AGENTS.md`, then the KNOWN-ISSUES.md entries
"SUB-AGENT ACTIVITY CLOCKS CAN SHOW UTC AS IF IT WERE LOCAL TIME" and
"Agents panel is provider-blind for detached jobs", then
`docs/project/ideal-agents-sidebar.md` (the plan/blocker register for part b).

## Part (a) — UTC clocks (small, do first)

The bug: the installed build rendered `entry.at.slice(11, 19)` — raw UTC HH:mm:ss with no
conversion and no UTC label (5h30m off under IST). Current source already uses
`formatTimestamp(entry.at, settings.timestampFormat)` via `Intl.DateTimeFormat` in
`apps/web/src/components/AgentsPanel.tsx`; shipping requires only a new build (not your job).

Your job: make regression permanent.

1. Verify NO remaining code path slices wall-clock times out of ISO strings for display anywhere
   in the Agents panel / tool-call rendering (search for `.slice(11`, `substring(11`, etc. across
   `apps/web/src` and `packages/client-runtime`). Fix any stragglers within your file ownership.
2. Add a regression test that runs the formatter under a forced non-UTC zone (`Asia/Kolkata`, e.g.
   `process.env.TZ` or an explicit timeZone option) proving a `Z` timestamp renders with the local
   offset applied, and that elapsed durations remain distinct from wall-clock times.

## Part (b) — provider-blind Agents panel for detached jobs

The KNOWN-ISSUES entry may be PARTIALLY STALE: `AGENTS.md` records that the server now tails
detached companion jobs and replays progress onto the forwarder's card
(`apps/server/src/provider/codexCompanionJobs.ts`), re-pinning it to `running` until the job
settles. On 2026-07-29 that path also gained startup reconciliation.

Your job:

1. AUDIT the current behavior against the ideal in `docs/project/ideal-agents-sidebar.md`: what
   does the panel actually show for a detached job today (launch → forwarder exits → job runs →
   job ends), and which gaps from the blocker register remain?
2. Implement the highest-value REMAINING gap that fits inside your file ownership below (e.g.
   richer live activity lines for the tailed job, clearer detached-job labeling, or surfacing job
   phase). If the register's top gaps all require files owned by other agents (see below), pick
   the best one that doesn't, and write up the rest as recommendations.
3. Do NOT attempt the full roadmap. One well-tested slice + an honest gap report beats a sprawl.

## Scope and file ownership (do NOT edit outside this)

- `apps/web/src/components/AgentsPanel.tsx` + `AgentsPanel.test.tsx`
- `packages/client-runtime/src/state/threadAgents.ts` + test (carries fresh verified uncommitted
  reconciliation work — build on it, never revert it)
- A new shared timestamp-format test file if needed, colocated with the formatter you're testing.

Other agents concurrently own `apps/server/src/provider/**` (including codexCompanionJobs.ts and
ClaudeAdapter.ts), `apps/web/src/components/chat/**`, `apps/web/src/components/ChatView.tsx`, and
`apps/web/src/session-logic.ts` — do not touch them. If a part-(b) gap needs them, report the
exact change instead of making it.

## Deliverables (raw data in your final message)

1. Part (a): straggler audit result (patterns searched, hits found/fixed), the timezone regression
   test, commands + results.
2. Part (b): the audit table (ideal vs actual per lifecycle stage), the slice you implemented,
   files changed + one-line summaries, tests + results, and written recommendations for the gaps
   you did not take.
3. End-goal statements: (a) a `Z` timestamp can never render unconverted-and-unlabeled again;
   (b) a user watching the panel during a detached job sees truthful status at every stage. State
   what your tests prove for each.

## Hard constraints

- NO `git commit`, NO branches, NO stash/reset/checkout. Preserve all uncommitted work.
- Do not start dev servers or the app.
- Focused tests only (`./node_modules/.bin/vp test run <files>`). Do not edit `.repos/`.
- `apps/web/src/components/chat/ChatComposer.tsx` contains NUL bytes — ripgrep skips it silently
  on directory sweeps; use `--text` or explicit paths.
