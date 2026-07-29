Implemented and left uncommitted.

### Files changed

- [decider.ts](C:/Users/Hritwik/Documents/GitHub/v3code/apps/server/src/orchestration/decider.ts:826) — interrupting a live session now emits a terminal `thread.session-set`, clears `activeTurnId`, and sets status to `interrupted`.
- [decider.settled.test.ts](C:/Users/Hritwik/Documents/GitHub/v3code/apps/server/src/orchestration/decider.settled.test.ts:355) — verifies interrupt emits both the interrupt request and terminal session event.
- [projector.test.ts](C:/Users/Hritwik/Documents/GitHub/v3code/apps/server/src/orchestration/projector.test.ts:345) — verifies an interrupted session clears its active turn and projects the turn as interrupted.
- [ProviderService.ts](C:/Users/Hritwik/Documents/GitHub/v3code/apps/server/src/provider/Layers/ProviderService.ts:228) — settles runtime state after interrupt and transactionally reconciles stale settled-turn sessions during startup while rechecking turn liveness.
- [ProviderService.test.ts](C:/Users/Hritwik/Documents/GitHub/v3code/apps/server/src/provider/Layers/ProviderService.test.ts:713) — verifies interrupt runtime settlement and cold-start reconciliation: stale rows clear, genuinely live rows remain untouched.

### Focused tests

Command run twice, including after formatting:

```text
vp test run apps/server/src/orchestration/decider.settled.test.ts apps/server/src/orchestration/projector.test.ts apps/server/src/provider/Layers/ProviderService.test.ts
```

Final output:

```text
Test Files  3 passed (3)
Tests       51 passed (51)
Duration    2.51s
```

The initial Windows launcher attempts did not execute tests because the root `.bin` shim was missing and Bun received `EPERM`; invoking the same `vp test run` through the available Node runtime succeeded.

Additional checks:

```text
vp fmt --check <five changed files>
PASS — all files correctly formatted

vp lint --report-unused-disable-directives <four files excluding projector.test.ts>
PASS — 0 warnings, 0 errors

git diff --check -- <five changed files>
PASS
```

Linting all five files found one pre-existing violation at `projector.test.ts:981` concerning an existing `Effect.runPromise`; it is unrelated to this change.

### Diagnosis and end goal

No behavior contradicted `KNOWN-ISSUES.md`. The interrupt path settled the turn but omitted both the terminal session event and runtime update exactly as diagnosed.

- Pressing stop: backend tests prove the projected session and runtime leave `running`, clear the active turn, and therefore satisfy the state the header reads. The installed UI itself was not launched, so the visible header behavior still needs an installed-app check.
- Restart self-healing: the SQLite startup test directly proves a pre-existing wedged session/runtime pair is settled, while a genuinely running turn remains untouched.

User-visible verification flow: start a turn, press stop, confirm the header no longer remains at `Working for Nh`; then restart with a historically wedged thread and confirm it opens settled.

No commit, branch, stash, dev server, watcher, or app launch was performed. Other agents’ concurrent files were untouched.
