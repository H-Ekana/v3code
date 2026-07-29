Implemented the restart reconciliation fix without touching `apps/web`, contracts, branches, commits, or unrelated work.

### Files changed

- [ClaudeAdapter.ts](C:/Users/Hritwik/Documents/GitHub/v3code/apps/server/src/provider/Layers/ClaudeAdapter.ts) — persists companion watcher correlations, restores them during session startup, watches live records, and fails vanished jobs without trusting or killing PIDs.
- [ClaudeAdapter.test.ts](C:/Users/Hritwik/Documents/GitHub/v3code/apps/server/src/provider/Layers/ClaudeAdapter.test.ts) — covers restart reattachment, continued watching, terminal settlement, vanished-job failure, and bogus stored PIDs.
- [codexCompanionJobs.ts](C:/Users/Hritwik/Documents/GitHub/v3code/apps/server/src/provider/codexCompanionJobs.ts) — reads capped `state.json`, per-job records/log mtimes, durable watcher registrations, and treats omission from a valid store as vanished.
- [codexCompanionJobs.test.ts](C:/Users/Hritwik/Documents/GitHub/v3code/apps/server/src/provider/codexCompanionJobs.test.ts) — covers store lookup, mtimes, stale PIDs, vanished entries, write-order races, and registration filtering.
- [ProviderRuntimeIngestion.ts](C:/Users/Hritwik/Documents/GitHub/v3code/apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts) — clears `phaseTitle` along with `currentActivity` when a companion settles.
- [ProviderRuntimeIngestion.test.ts](C:/Users/Hritwik/Documents/GitHub/v3code/apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts) — verifies the terminal roster snapshot has `status: failed`, with `currentActivity` and `phaseTitle` absent.

### Focused test results

- Restart with a non-terminal record: fresh adapter reattached without observing a launch line, emitted `running`, remained watched, then emitted `completed` after the record changed. A bogus PID was deliberately present. Passed.
- Restart with terminal/vanished records: terminal job emitted `completed`; vanished job emitted `failed` with an explicit vanished-state error. Neither terminal event carried `phaseTitle`. Passed.
- Roster folding: terminal companion snapshot cleared both `currentActivity` and `phaseTitle`. Passed.
- Lazy hydration: reconciliation emits an ordinary agent-touching `task.updated`; ingestion therefore hydrates the persisted roster before folding and publishes the newer `agent.snapshot`. The ingestion rehydration suite passed.

Exact commands:

```powershell
node_modules\.bin\vp.cmd test run apps/server/src/provider/codexCompanionJobs.test.ts
# 1 file passed; 24/24 tests passed

node_modules\.bin\vp.cmd test run apps/server/src/provider/Layers/ClaudeAdapter.test.ts -t restart
# 1 file passed; 2/2 selected tests passed; 68 skipped

node_modules\.bin\vp.cmd test run apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts
# 1 file passed; 54/54 tests passed

node_modules\.bin\vp.cmd check apps/server/src/provider/codexCompanionJobs.ts apps/server/src/provider/codexCompanionJobs.test.ts apps/server/src/provider/Layers/ClaudeAdapter.ts apps/server/src/provider/Layers/ClaudeAdapter.test.ts apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts
# All 6 correctly formatted; no lint warnings/errors
```

`git diff --check` also passed for all six files.

### Diagnosis check

Nothing contradicts the root-cause diagnosis. One version-sensitive detail: current upstream plugin source caps persisted jobs at 50, while status output defaults to showing eight; the observed eight is therefore not necessarily the persistent-store cap. The fix makes no count assumption. [Current state-store implementation](https://raw.githubusercontent.com/openai/codex-plugin-cc/main/plugins/codex/scripts/lib/state.mjs), [status-list implementation](https://raw.githubusercontent.com/openai/codex-plugin-cc/main/plugins/codex/scripts/lib/job-control.mjs).

### End goal

Yes—the tests prove the server/runtime path: after restart, a finished companion job settles its card autonomously, including clearing the running activity and phase, without a repair script or dummy-subagent trigger. Installed-app visual verification remains advisable because launching the app was explicitly prohibited.
