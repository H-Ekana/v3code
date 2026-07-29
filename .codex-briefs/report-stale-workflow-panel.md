Implemented the workflow hydration fix. No commit, branch, stash, server launch, or app launch was performed.

### Traced path

- Workflow progress → task events: [ClaudeAdapter.ts](/C:/Users/Hritwik/Documents/GitHub/v3code/apps/server/src/provider/Layers/ClaudeAdapter.ts:3293)
- Roster fold: [ProviderRuntimeIngestion.ts](/C:/Users/Hritwik/Documents/GitHub/v3code/apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:163)
- `agent.snapshot` persistence: [ProviderRuntimeIngestion.ts](/C:/Users/Hritwik/Documents/GitHub/v3code/apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:1822)
- Persisted activity hydration: [ProjectionSnapshotQuery.ts](/C:/Users/Hritwik/Documents/GitHub/v3code/apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:1100), attached to thread at line 1220
- Hydrated activities → roster reducer: [ChatView.tsx](/C:/Users/Hritwik/Documents/GitHub/v3code/apps/web/src/components/ChatView.tsx:2244)
- Terminal reconciliation: [threadAgents.ts](/C:/Users/Hritwik/Documents/GitHub/v3code/packages/client-runtime/src/state/threadAgents.ts:113)
- Panel grouping/count reducer: [threadAgents.ts](/C:/Users/Hritwik/Documents/GitHub/v3code/packages/client-runtime/src/state/threadAgents.ts:282)
- Footer rendering: [AgentsPanel.tsx](/C:/Users/Hritwik/Documents/GitHub/v3code/apps/web/src/components/AgentsPanel.tsx:767)

Root cause: `deriveLatestAgentSnapshot` selected only the highest-revision `agent.snapshot`, ignoring matching persisted `task.completed` activities. Therefore a stale running frame remained authoritative after reopening.

### Files changed

- [threadAgents.ts](/C:/Users/Hritwik/Documents/GitHub/v3code/packages/client-runtime/src/state/threadAgents.ts:48) — reconciles terminal task results, rejects results from older activations, and settles source-dead workflow children.
- [threadAgents.test.ts](/C:/Users/Hritwik/Documents/GitHub/v3code/packages/client-runtime/src/state/threadAgents.test.ts:88) — adds returned-workflow, stale-result, footer-count, and reactivation regressions.
- [AgentsPanel.tsx](/C:/Users/Hritwik/Documents/GitHub/v3code/apps/web/src/components/AgentsPanel.tsx:275) — prevents settled/end-marked entries from starting live elapsed timers.
- [AgentsPanel.test.tsx](/C:/Users/Hritwik/Documents/GitHub/v3code/apps/web/src/components/AgentsPanel.test.tsx:147) — verifies footer/card agreement and static settled timers.

### Verification

Exact focused command:

```powershell
./node_modules/.bin/vp test run packages/client-runtime/src/state/threadAgents.test.ts apps/web/src/components/AgentsPanel.test.tsx
```

Result: PASS — 2 files, 45 tests.

- `threadAgents.test.ts`: 21 passed
- `AgentsPanel.test.tsx`: 24 passed
- Client-runtime TypeScript diagnostics: 0 errors
- Web TypeScript diagnostics: 0 errors
- Formatter: clean on all four files
- `git diff --check`: clean

The tests prove the persisted-activity → hydrated roster → cards/footer/timer invariant: reopening a finished workflow materializes every child as settled, elapsed times remain static, and footer counts match card states. Installed-app reopening remains the final manual verification: reopen a completed Claude workflow and confirm zero running agents, static durations, and matching settled counts.
