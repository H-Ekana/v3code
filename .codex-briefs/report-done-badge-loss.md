Implemented the fix, uncommitted, within the requested ownership boundaries.

Files changed:

- [ProjectionPipeline.ts](C:/Users/Hritwik/Documents/GitHub/v3code/apps/server/src/orchestration/Layers/ProjectionPipeline.ts:887) — preserves the existing turn pointer when `activeTurnId` is null.
- [ProjectionPipeline.test.ts](C:/Users/Hritwik/Documents/GitHub/v3code/apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts:1436) — adds `running → turn-diff-completed → ready` regression coverage and verifies `latest_turn_id` survives.
- [ChatView.tsx](C:/Users/Hritwik/Documents/GitHub/v3code/apps/web/src/components/ChatView.tsx:2056) — consumes the visit baseline once per explicit route engagement, not passive server updates.
- [ChatView.logic.ts](C:/Users/Hritwik/Documents/GitHub/v3code/apps/web/src/components/ChatView.logic.ts:31) — adds the testable visit-baseline resolver.
- [ChatView.logic.test.ts](C:/Users/Hritwik/Documents/GitHub/v3code/apps/web/src/components/ChatView.logic.test.ts:119) — proves passive completion leaves `hasUnseenCompletion` true until explicit activation.
- [Sidebar.logic.ts](C:/Users/Hritwik/Documents/GitHub/v3code/apps/web/src/components/Sidebar.logic.ts:465) — makes unread glow additive, preserving it on active rows.
- [Sidebar.logic.test.ts](C:/Users/Hritwik/Documents/GitHub/v3code/apps/web/src/components/Sidebar.logic.test.ts:1150) — verifies active background and unread perimeter glow coexist.

Focused test command attempted:

```text
vp test run apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts apps/web/src/components/ChatView.logic.test.ts apps/web/src/components/Sidebar.logic.test.ts
```

Result:

```text
FAIL TO START — exit 1, 0 tests executed
'vp' is not recognized as an internal or external command,
operable program or batch file.
```

The checkout has no `node_modules` or `vp`, and dependency restoration was blocked by disabled package-network access.

Additional verification:

```text
git diff --check <seven scoped files>
PASS — exit 0, no output
```

```text
bun build <seven scoped files> --external * --outdir .codex-tmp/syntax
PASS — 7 modules parsed/bundled in 83ms
```

The temporary parse output was removed. No commit, branch, stash, server, app, or watcher was created.

User-observable end goal: a thread that finishes while unopened keeps its themed `Done` check and perimeter glow until the user opens it; opening acknowledges it. The added tests assert every underlying part of that behavior, but they do **not yet constitute executed proof** because the focused test runner could not start. Please verify the same finish-without-opening → glow/Done → open-to-acknowledge flow in the installed app after dependencies and tests are available.
