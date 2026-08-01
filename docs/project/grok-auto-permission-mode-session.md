# Grok Auto permission mode — session log & code handoff

**Date:** 2026-08-01  
**Checkout:** `C:\Users\Hritwik\Documents\GitHub\v3code` (branch `main`, shared WIP tree)  
**Scope:** Make T3 **Auto** for Grok behave like Codex Auto (classifier: routine tools pass, risky still ask).  
**Status:** Uncommitted WIP. Server `apps/server/dist` was rebuilt during the session; Electron must be restarted to load it.  
**Full path of this file:** `C:\Users\Hritwik\Documents\GitHub\v3code\docs\project\grok-auto-permission-mode-session.md`

---

## 1. User request (what we were actually asked to do)

1. **Diagnosis (read-only first):** Why Grok “auto-approve” doesn’t work in this V3 Code build the way Codex does.
2. **Clarify product intent:** User wants **T3 mode `auto`**, not Full access / always-approve / `--always-approve`.
3. **Implement** Auto → Grok’s native classifier auto mode.
4. **Explicitly rejected:** Spawning Full access with Grok always-approve (`--always-approve` / `bypassPermissions` / `yoloMode: true`) as the “fix.”

---

## 2. Background: T3 runtime modes vs Grok native modes

### T3 (`RuntimeMode` in contracts)

| T3 value            | UI label          | Intent                                              |
| ------------------- | ----------------- | --------------------------------------------------- |
| `approval-required` | Supervised        | Ask before commands and file changes                |
| `auto-accept-edits` | Auto-accept edits | Edits free; other actions ask                       |
| `auto`              | Auto              | Routine OK; risky still asks (Codex: `auto_review`) |
| `full-access`       | Full access       | No prompts (default for new threads)                |

Sources: `packages/contracts/src/orchestration.ts` (`RuntimeMode`), `docs/user/permission-modes.md`, composer labels in `apps/web/src/components/chat/CompactComposerControlsMenu.tsx`.

### Grok CLI / ACP (external)

From `grok --help` and `~/.grok/docs/user-guide/22-permissions-and-safety.md` / `15-agent-mode.md`:

| Mechanism                         | Values / behavior                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| CLI `--permission-mode`           | `default` (ask), `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions` (always-approve), `plan` |
| CLI `grok agent --always-approve` | Always-approve for agent transports                                                             |
| ACP `session/new` `_meta`         | `yoloMode: true` (always-approve), `autoMode: true` (classifier auto)                           |
| Config `~/.grok/config.toml`      | `[ui] permission_mode = "ask" \| "auto" \| "always-approve"`                                    |

**Critical spawn detail:** `--permission-mode` is a **top-level** `grok` flag, not under `grok agent`:

```text
grok --permission-mode auto agent stdio   # correct shape
grok agent --permission-mode auto stdio   # rejected by CLI
```

---

## 3. Root-cause findings (research)

### 3.1 Pre-existing gap (before this session)

`GrokAdapter` only client-auto-approved ACP tool permissions when `runtimeMode === "full-access"` (select `allow_always` / `allow_once` on `session/request_permission`).

- **T3 Auto** for Grok did **nothing special** → behaved like Supervised if Grok still asked.
- Codex maps `auto` → `approvalsReviewer: "auto_review"`; Claude maps `auto` → `permissionMode: "auto"`.
- Docs previously listed OpenCode as falling back to ask; Grok was omitted.

### 3.2 Confusion that delayed the real fix

“Auto-approve” was repeatedly conflated with **Full access / always-approve**. User corrected: they want **Auto (classifier)**, not Full access.

### 3.3 Live Grok ACP probes (this machine)

Probes against real `grok` (0.2.x) from the worktree:

| Client capabilities                       | File-write smoke                    | Observed                                                                                                                              |
| ----------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `writeTextFile: false` (T3’s old default) | Create tiny file                    | **No** `session/request_permission`; file written in-process; prompt ends `end_turn`                                                  |
| `writeTextFile: true`                     | Create tiny file; refuse `fs/write` | Grok called `fs/write_text_file`, then fell back to shell and **did** emit `session/request_permission` for `Execute Set-Content ...` |

**Conclusion:** With FS ownership off, Grok can mutate files **without** ever asking the ACP client. Supervised cards for pure file creates were unreliable or absent for that path—not only an “Auto mapping” problem.

### 3.4 Process audit during user testing

Live `grok.exe` command lines included a mix of:

- `grok agent stdio` (no permission-mode flag)
- `grok --permission-mode default agent stdio` (our Supervised mapping)

Also running: **installed** `V3 Code (V3 Preview)` (`AppData\Local\Programs\v3code\...app.asar`) **and** Electron dev loading `apps/server/dist/bin.mjs`. Testing without a full restart can mix old and new server code.

User’s `~/.grok/config.toml` had `permission_mode = "ask"`, `yolo = false`, `fork_secondary_model = "grok-4.5"`.

### 3.5 Control-test failure (user screenshots)

- Tiny file create under **Auto** / **Supervised** both completed **without** approval cards.
- That looked like “Auto works,” then “Supervised is broken.”
- Partial truth: (a) file path often never asked; (b) for a while we incorrectly forced Full access → always-approve at spawn (see §5 mistakes).

---

## 4. Intended design after discussion

| T3 mode               | Desired Grok / T3 behavior                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auto**              | Grok native classifier: `--permission-mode auto` + session `_meta.autoMode: true`. When Grok still asks, T3 shows UI.                                          |
| **Supervised**        | Ask: `--permission-mode default` + clear sticky auto/yolo meta. Client must not auto-approve permission RPCs.                                                  |
| **Auto-accept edits** | `--permission-mode acceptEdits` + clear sticky meta; client may auto-approve edit-like permission RPCs; FS writes auto-allowed.                                |
| **Full access**       | **Do not** force Grok always-approve at process level. Bare `agent stdio`. T3 continues client-auto-approving permission RPCs when they arrive (pre-existing). |

User explicitly rejected process-level always-approve as the Full access solution.

---

## 5. Mistakes made in this session (do not repeat)

1. **Proposed `--always-approve` / Full access as the fix** for “auto-approve” despite user wanting Codex-like Auto.
2. **Implemented Full access → `bypassPermissions` + `yoloMode: true`** “for completeness.” That muted Grok’s permission system on **default** threads and was exactly what the user did not want. **Reverted** (see §6.1 final mapping).
3. **Over-indexed on tiny file-write smokes** as proof of Auto/Supervised; those can bypass `request_permission` when client FS is off.
4. **FS write gate** is a real hole-fix for edits but is **not** a complete Supervised policy for shell/terminal (terminal still not owned by T3). User flagged this as bandaid risk; fair.

---

## 6. Code changes (current tree state)

Approx. diffstat (permission work only):

```text
apps/server/src/orchestration/Layers/ProviderCommandReactor.ts | +resume drop for Grok mode change
apps/server/src/provider/Layers/GrokAdapter.ts                 | +FS client + write gate + permission helper
apps/server/src/provider/acp/AcpSessionRuntime.ts              | +sessionSetupMeta on new/load
apps/server/src/provider/acp/GrokAcpSupport.ts                 | +mode → CLI/meta mapping + spawn args
apps/server/src/provider/acp/GrokAcpSupport.test.ts            | +unit tests
docs/user/permission-modes.md                                  | +Grok Auto wording
```

Note: `ProviderCommandReactor.ts` may also contain **unrelated** WIP (stale approval detail strings) from other concurrent edits in this shared tree. Only the Grok resume-drop lines below are part of this session’s permission work.

---

### 6.1 `apps/server/src/provider/acp/GrokAcpSupport.ts`

**Mapping (final, after Full access always-approve revert):**

| Function                          | Lines (approx.) | Behavior                                                                                                                                       |
| --------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GrokCliPermissionMode` type      | 21–33           | Documents CLI enum                                                                                                                             |
| `runtimeModeToGrokPermissionMode` | 52–74           | `auto`→`auto`; `auto-accept-edits`→`acceptEdits`; `approval-required`→`default`; **`full-access`→`undefined`** (no spawn flag)                 |
| `runtimeModeToGrokSessionMeta`    | 76–99           | `auto`→`{ autoMode: true, yoloMode: false }`; Supervised / auto-accept-edits clear sticky; **`full-access`→`undefined`** (no `yoloMode: true`) |
| `buildGrokAcpSpawnInput`          | 101–124         | Prepends `--permission-mode <mode>` only when mapping is defined                                                                               |
| `makeGrokAcpRuntime`              | 132–165         | Passes `runtimeMode` into spawn + `sessionSetupMeta` into ACP layer                                                                            |

**Spawn shapes:**

```text
# Auto
grok --permission-mode auto agent stdio

# Supervised
grok --permission-mode default agent stdio

# Auto-accept edits
grok --permission-mode acceptEdits agent stdio

# Full access (unchanged from pre-session default spawn)
grok agent stdio
```

---

### 6.2 `apps/server/src/provider/acp/AcpSessionRuntime.ts`

| Item                                        | Lines (approx.) | Change                                     |
| ------------------------------------------- | --------------- | ------------------------------------------ |
| `AcpSessionRuntimeOptions.sessionSetupMeta` | 67–72           | Optional `_meta` bag for session setup     |
| `session/load` payload                      | ~570            | Spreads `_meta: sessionSetupMeta` when set |
| `session/new` payload                       | ~644            | Same                                       |

Used by Grok for `autoMode` / sticky clear; not a Cursor/Codex change unless they pass the option.

---

### 6.3 `apps/server/src/provider/Layers/GrokAdapter.ts`

| Item                                                      | Lines (approx.) | Change                                                                                                        |
| --------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------- |
| `grokFsWriteIsAutoAllowed`                                | 206–217         | Auto-allow FS writes for `full-access`, `auto-accept-edits`, `auto`                                           |
| `shouldClientAutoApproveGrokPermission`                   | 219–232         | Full access: all; auto-accept-edits: edit/delete/move only; Auto/Supervised: **false** (show UI if Grok asks) |
| `makeGrokAcpRuntime({ runtimeMode, clientCapabilities })` | 602–615         | Pass mode; **`fs: { readTextFile: true, writeTextFile: true }`**                                              |
| `handleReadTextFile`                                      | 704–722         | Read from host FS                                                                                             |
| `handleWriteTextFile`                                     | 723–787         | Supervised: open `request.opened` (kind `edit`) and wait; then write or deny                                  |
| `handleRequestPermission`                                 | 788+            | Uses `shouldClientAutoApproveGrokPermission` instead of only `full-access`                                    |

**Pre-existing (not introduced for Auto, still present):** full-access client auto-select of `allow_always` / `allow_once` when a permission RPC arrives.

**Not done:** client `terminal: true` + terminal handlers. Shell still depends on Grok emitting `session/request_permission`.

---

### 6.4 `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`

| Item                              | Lines (approx.) | Change                                                                                                                                                  |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dropResumeForGrokPermissionMode` | 816–825         | When `runtimeModeChanged && preferredProvider === "grok"`, **drop resume cursor** so mode switches do not rehydrate sticky Grok auto/yolo session state |

Trade-off: Grok conversation resume is lost on T3 permission-mode switches only; orchestration thread history remains.

---

### 6.5 `apps/server/src/provider/acp/GrokAcpSupport.test.ts`

Unit tests for:

- `runtimeModeToGrokPermissionMode` (incl. Full access → `undefined`)
- `runtimeModeToGrokSessionMeta` (incl. Full access → `undefined`, no yolo)
- `buildGrokAcpSpawnInput` argv per mode

**Result last run:** 10/10 pass via `vp test run apps/server/src/provider/acp/GrokAcpSupport.test.ts`.

`GrokAdapter.test.ts` integration suite on Windows fails with `spawn EFTYPE` on `#!/bin/sh` mock wrappers (pre-existing platform issue; not used as gate for this work).

---

### 6.6 `docs/user/permission-modes.md`

| Lines (approx.) | Change                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| 18–21           | Auto: Grok uses classifier auto permission mode                                                                |
| 41–46           | Provider behavior: Grok Auto turns on classifier; does **not** describe forcing always-approve for Full access |

---

## 7. Final mode matrix (as implemented now)

| T3 mode           | Spawn args                                  | Session `_meta`                        | Client `request_permission`      | Client FS write     |
| ----------------- | ------------------------------------------- | -------------------------------------- | -------------------------------- | ------------------- |
| Auto              | `--permission-mode auto agent stdio`        | `{ autoMode: true, yoloMode: false }`  | Show UI if Grok asks             | Auto-allow          |
| Supervised        | `--permission-mode default agent stdio`     | `{ autoMode: false, yoloMode: false }` | Always UI if Grok asks           | **Card then write** |
| Auto-accept edits | `--permission-mode acceptEdits agent stdio` | clear sticky                           | Auto edit/delete/move only       | Auto-allow          |
| Full access       | `agent stdio` only                          | none                                   | Pre-existing client auto-approve | Auto-allow          |

---

## 8. How to verify (dev Electron)

1. Rebuild server if needed: `vp run --filter t3 build:bundle` (or `.\node_modules\.bin\vp.cmd run --filter t3 build:bundle`).
2. **Fully quit** Electron / installed V3 Preview so only one server loads `apps/server/dist/bin.mjs`.
3. Start: `pnpm electron:dev` or `node scripts/v3-electron-dev.mjs`.
4. Prefer a **new thread**; set mode **before** first send.

### Auto (classifier)

```text
Create a file named .t3-auto-retry2.txt in the project root containing exactly: auto-ok
Do not run any shell commands. Only write that one file, then stop.
```

Expect: write proceeds without card (FS auto-allow +/or Grok auto).  
Also: process cmdline should include `--permission-mode auto`.

### Supervised (must ask for write after FS ownership)

```text
Create a file named .t3-supervised-retry2.txt in the project root containing exactly: must-ask
Do not run any shell commands. Only write that one file, then stop.
```

Expect: **approval card** before file exists; file only after Approve.

### Regression check for “git still asks” (tool path)

```text
Run git status in this repo and stop. Do not modify any files.
```

On Supervised: expect a card if Grok requests execute permission.  
On Full access: may auto-answer without card (client path), but should **not** require Grok `bypassPermissions`.

Confirm spawn with Process Explorer / WMI: Full access should **not** show `--permission-mode bypassPermissions`.

---

## 9. Known gaps / follow-ups

1. **Terminal ownership:** T3 still advertises `terminal: false` for Grok. Consequential shell that Grok runs without `request_permission` is still a Supervised hole. Non-bandaid fix: implement client terminal handlers + mode matrix (same spirit as FS).
2. **Complete Supervised policy:** FS gate + permission RPC UI is not a full “all mutations stop” guarantee.
3. **Sticky grants:** Grok may remember interactive “always allow” grants per project outside this repo; can mask Supervised prompts independently of T3.
4. **Shared tree:** Do not commit without user request; other agents may have concurrent edits in `ProviderCommandReactor` and elsewhere.
5. **Installed app vs dev:** `AppData\Local\Programs\v3code\` does not automatically include this WIP.

---

## 10. Conversation timeline (compressed)

1. Read-only research: only Full access auto-picked ACP options; Auto unmapped for Grok.
2. User: want Auto like Codex, not Full access.
3. Implemented spawn/meta mapping for all modes—including mistaken Full access always-approve.
4. User smoke tests: no cards on Supervised file create → “big oof.”
5. Probes: Grok in-process writes without permission when client FS off.
6. Added client FS + Supervised write gate; rebuild dist.
7. User: is FS-only a bandaid? Honest answer: incomplete for shell/terminal.
8. User: git/read/write already asked sometimes—what did we regress?
9. Audit: Full access → `bypassPermissions`/`yoloMode` was the main accidental mute on default threads.
10. User call-out: that Full access change was unwanted.
11. Reverted Full access process-level always-approve; kept Auto classifier mapping + Supervised clear + FS gate.
12. This document written.

---

## 11. Quick file index (absolute paths)

| Path                                                                                                      |
| --------------------------------------------------------------------------------------------------------- |
| `C:\Users\Hritwik\Documents\GitHub\v3code\apps\server\src\provider\acp\GrokAcpSupport.ts`                 |
| `C:\Users\Hritwik\Documents\GitHub\v3code\apps\server\src\provider\acp\GrokAcpSupport.test.ts`            |
| `C:\Users\Hritwik\Documents\GitHub\v3code\apps\server\src\provider\acp\AcpSessionRuntime.ts`              |
| `C:\Users\Hritwik\Documents\GitHub\v3code\apps\server\src\provider\Layers\GrokAdapter.ts`                 |
| `C:\Users\Hritwik\Documents\GitHub\v3code\apps\server\src\orchestration\Layers\ProviderCommandReactor.ts` |
| `C:\Users\Hritwik\Documents\GitHub\v3code\docs\user\permission-modes.md`                                  |
| `C:\Users\Hritwik\Documents\GitHub\v3code\docs\project\grok-auto-permission-mode-session.md` (this file)  |

External references used during research:

- `C:\Users\Hritwik\.grok\docs\user-guide\22-permissions-and-safety.md`
- `C:\Users\Hritwik\.grok\docs\user-guide\15-agent-mode.md`
- `https://docs.x.ai/build/modes-and-commands`
- `https://docs.x.ai/build/features/permissions`
