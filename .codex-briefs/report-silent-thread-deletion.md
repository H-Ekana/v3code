Implemented and left uncommitted.

Files changed:

- [useThreadActions.ts](C:\Users\Hritwik\Documents\GitHub\v3code\apps\web\src\hooks\useThreadActions.ts:115) — removed client-side provider-stop/terminal-close gates, added durable-first dispatch, actionable failure toast, and provider/thread-suffix diagnostics.
- [useThreadActions.test.ts](C:\Users\Hritwik\Documents\GitHub\v3code\apps\web\src\hooks\useThreadActions.test.ts:28) — added hanging-cleanup and failed-delete regressions.

Verification:

- `vp test run apps/web/src/hooks/useThreadActions.test.ts`
  - PASS: 1 file, 3 tests, 0 failures.
- `vp fmt --check apps/web/src/hooks/useThreadActions.ts apps/web/src/hooks/useThreadActions.test.ts`
  - PASS: both files correctly formatted.
- `vp lint apps/web/src/hooks/useThreadActions.ts apps/web/src/hooks/useThreadActions.test.ts`
  - PASS: 0 warnings, 0 errors.
- Focused `git diff --check`
  - PASS.

The regression starts a never-settling terminal-close operation and proves the durable delete still dispatches. The failure test proves an unsuccessful delete returns its failure and shows a retry-oriented toast containing `Codex` and thread suffix `…7c0e4b2a`.

End goal: confirming Delete must either remove the exact selected thread or show an actionable failure—never silently do nothing. Tests prove this client-side invariant, including exact scoped-thread dispatch and visible failure handling; they do not independently prove the complete backend-to-sidebar flow in the installed app.

Recommended installed-app check: create two same-title threads under different providers, delete one, and confirm either that exact row disappears or the contextual failure toast appears.
