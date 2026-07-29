Verify the following performance diagnosis in this repo and report back whether it is true, with confirmed/refuted per claim and file:line references. Investigation only — do not modify any files.

## Context

On Windows, the WMI service (winmgmt, "Service Host: Windows Management Instrumentation") was observed at ~34% CPU. Forensics traced it to short-lived powershell.exe processes whose parent is the V3 Code (V3 Preview) process, issuing WMI queries every ~6.5 seconds. The WMI-Activity event log showed repeated queries like `SELECT * FROM Win32_PerfFormattedData_PerfProc_Process WHERE IDProcess = 4` (also IDProcess = 332), each failing with 0x800706BA "could not send status to client", plus bursts of `SELECT __PATH, ProcessId, CSName, Caption, SessionId, ThreadCount, WorkingSetSize, KernelModeTime, UserModeTime, ParentProcessId FROM Win32_Process` from many concurrent short-lived processes.

## Claims to verify

1. `apps/server/src/diagnostics/ProcessDiagnostics.ts`, function `readWindowsProcessRows` (~lines 440-474), builds a PowerShell command that, for EVERY process returned by `Get-CimInstance Win32_Process`, issues a SEPARATE `Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "IDProcess = $($_.ProcessId)"` query. Since each PerfFormattedData query internally enumerates/computes perf data for ALL processes (the WHERE/-Filter is applied post-enumeration), one poll is effectively O(N^2) — roughly 400 full-system perf enumerations when ~400 processes are running — explaining the WMI CPU burn.

2. The spawned powershell.exe is killed by `PROCESS_QUERY_TIMEOUT_MS` before the query completes (find the constant's value and confirm it is plausibly shorter than the O(N^2) query duration), which explains the 0x800706BA "client died" errors. Some caller retries this on a ~6.5-second cadence — find the caller/scheduler responsible for the polling/retry loop and state its interval and retry behavior.

3. Proposed fix: query `Win32_PerfFormattedData_PerfProc_Process` ONCE into a hashtable keyed by IDProcess, then join in memory while iterating `Win32_Process`. Verify this is correct and sufficient (one enumeration instead of N), and whether the poll would then complete within the timeout so the fail/retry churn stops. Note any edge cases (e.g., IDProcess type coercion, duplicate process names, PID reuse).

4. Separate lead: something in this codebase (parent confirmed as V3 Code at least once) spawns `git` + `conhost` roughly 3 times per second continuously (~180 spawns/minute). Find the responsible code — likely a git status watcher/poller (see also `apps/server/src/terminal/Manager.ts:632` which shells out a Win32_Process enumeration) — report its file:line and effective polling interval, and whether it explains the observed spawn rate and the bursts of Win32_Process queries.

## Report format

Per claim: CONFIRMED / REFUTED / PARTIAL, evidence with file:line references, and any corrections to the diagnosis.
