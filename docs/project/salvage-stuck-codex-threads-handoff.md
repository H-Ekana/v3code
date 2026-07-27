# Salvage Stuck Codex Threads

## Goal

Recover assistant messages that exist in Codex JSONL transcripts but never reached V3 Code's main
conversation, then clear the false `Working` state.

## Important safety rule

**V3 Code must be completely closed before applying the repair.**

Do not run two repair processes concurrently.

An earlier harness may already have armed watcher process PID `33060`. Before starting another
repair, check whether it still exists:

```powershell
Get-Process -Id 33060 -ErrorAction SilentlyContinue
```

If PID `33060` exists, either let it perform the repair after V3 Code closes or stop it before
running the commands below:

```powershell
Stop-Process -Id 33060
```

## Affected V3 threads

```text
065af0fb-1e86-44f5-a569-fd626f655df0
e3f18b59-6226-44aa-b7c3-160b46c681c1
```

The first is the design thread titled "Spectacular send button animation polish." The second is the
thread used to diagnose and fix this bug.

## Repair script

```text
C:\Users\vasus\Documents\v3code\scripts\salvage-codex-threads.mjs
```

It:

- locates each thread's Codex session through `provider_session_runtime.resume_cursor_json`;
- reads completed assistant messages from the matching `~/.codex/sessions/...jsonl`;
- skips messages already present in V3 projections or orchestration events;
- appends deterministic `thread.message-sent` recovery events;
- uses raw Codex `task_complete` events as terminal proof;
- repairs the stale turn/session/runtime state;
- backs up `state.sqlite`, `state.sqlite-wal`, and `state.sqlite-shm` before writing; and
- is idempotent, so a second run does not duplicate recovered messages.

## Tests already run

```powershell
node --test scripts\salvage-codex-threads.test.mjs
```

Result: 3 tests passed, covering extraction, transcript completion evidence, backup, state repair,
message recovery, and second-run deduplication.

The source routing fix also passed 55 focused `CodexSessionRuntime` and `CodexAdapter` tests.

## Step 1: close V3 Code

Close every V3 Code window. Verify no app processes remain:

```powershell
Get-Process -Name "V3 Code (V3 Preview)" -ErrorAction SilentlyContinue
```

The command should return nothing.

## Step 2: dry run

From a normal terminal:

```powershell
cd C:\Users\vasus\Documents\v3code

node scripts\salvage-codex-threads.mjs `
  --thread 065af0fb-1e86-44f5-a569-fd626f655df0 `
  --thread e3f18b59-6226-44aa-b7c3-160b46c681c1
```

The last verified dry run found:

```text
29 missing assistant messages in 065af0fb-1e86-44f5-a569-fd626f655df0
22+ missing assistant messages in e3f18b59-6226-44aa-b7c3-160b46c681c1
Both stale spinners were repairable
```

The second count may increase because this conversation continued afterward.

## Step 3: apply

Only after confirming V3 Code is closed:

```powershell
node scripts\salvage-codex-threads.mjs `
  --apply `
  --thread 065af0fb-1e86-44f5-a569-fd626f655df0 `
  --thread e3f18b59-6226-44aa-b7c3-160b46c681c1
```

Expected output includes:

```text
Recovered N message(s).
Repaired 2 stale session(s).
Backup: C:\Users\vasus\.t3\userdata\state.sqlite.salvage-backup-...
```

Do not delete the backup.

## Step 4: reopen and verify

Reopen V3 Code. Its projection pipeline should consume the newly appended recovery events.

Verify:

1. Both threads no longer show `Working`.
2. The missing assistant messages appear in the central conversation.
3. The bogus `root` card no longer receives new parent replies after running an updated build.

If recovered messages do not appear immediately, close and reopen V3 Code once more. Do not rerun
the repair until checking the database and the first run's output; the script is idempotent, but the
first run should be diagnosed rather than blindly repeated.

## Root cause and source fix

The bug is confirmed.

A child-to-parent `subAgentActivity` targeting `agentPath: "/root"` caused
`CodexSessionRuntime` to register the canonical parent provider thread as a child. Every later parent
message and turn lifecycle event was diverted into `collab/agentActivity`, which made it visible in
the `root` sidebar card but absent from the main conversation.

The fix is in:

```text
apps/server/src/provider/Layers/CodexSessionRuntime.ts
apps/server/src/provider/Layers/CodexSessionRuntime.test.ts
KNOWN-ISSUES.md
```

The fix:

- rejects bare `/root` activity as a child registration;
- rejects the canonical provider thread ID as a child;
- removes a poisoned root entry; and
- prevents the canonical provider thread from ever entering the child diversion path.

The currently installed/running app must be rebuilt and restarted with this source fix. Database
recovery salvages old messages and state; it does not update the installed application binary.
