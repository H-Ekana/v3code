# Installer payload

## Problem

The Windows installer exceeds 150 MB. Electron is a substantial floor, but the build also stages the
desktop and server production dependency trees and unpacks `node_modules` for WSL compatibility.

## Evidence already established

- Electron languages are already limited to `en-US`.
- Unused `@anthropic-ai/claude-agent-sdk-*` platform executables are already excluded.
- electron-builder's node-module copier excludes `.pdb` files unless `includePdb` is enabled; V3
  Code does not enable it. The local debug symbols therefore are not shipped weight.
- electron-builder does not exclude source maps or prune wrong-architecture folders nested inside a
  package.
- The installed `node-pty` package is about 62.6 MiB locally. Its roughly 47 MiB of `.pdb` files are
  already filtered, but a Windows x64 artifact still retains roughly 5 MiB of non-PDB ARM64
  prebuilds.
- `playwright-core` is about 11.9 MiB and is used by preview automation; it is not safe to remove as
  an assumed dev-only package.
- Production source maps are enabled in web, server, and desktop Vite builds.

## Benchmark gate

Build Windows x64 with the stage retained, then report:

- NSIS installer bytes;
- unpacked installed bytes and file count;
- Electron floor vs `resources`;
- `app.asar` and `app.asar.unpacked`;
- per-package and per-extension totals;
- source-map, debug-symbol, and non-target-native totals;
- compression ratios for the largest categories.

Installed baseline already observed without launching the app:

- installer: 154,522,095 bytes (147.36 MiB);
- installed tree: 516.39 MiB across 14,623 files;
- `resources`: 218.34 MiB, of which `app.asar.unpacked` is 203.71 MiB;
- packaged source maps in the unpacked tree: 64.32 MiB across 2,627 files (45.54 MiB app
  bundles, 18.78 MiB dependencies);
- runtime-unreachable `effect/src` and `@effect/*/src` sources: at least 16.5 MiB;
- runtime-unreachable `.d.mts`/`.d.cts` declarations: 2.85 MiB;
- packaged `playwright-core`: 10.15 MiB;
- wrong-platform/wrong-architecture `node-pty` prebuilds: about 2.61 MiB in this x64 install.

The installed artifact embeds commit `d4eabc10eed4`; current `main` differs by one unrelated sidebar
label commit, so a retained-stage build of `37717bb8` remains the controlled code baseline.

An untouched build of `37717bb8` using the documented x64 command and exact version
`0.0.31-nightly.20260729.946.v3.0.0.5` produced:

- NSIS installer: 154,501,547 bytes (147.34 MiB);
- retained raw staging app: 1,839,715,623 bytes across 37,713 files before electron-builder's file
  filters and compression.

## Candidate changes, in order

1. Exclude packaged source maps while retaining their generation for local debugging and non-desktop
   artifacts.
2. Exclude `.d.mts`/`.d.cts` declarations and the runtime-unreachable `src` trees from `effect` and
   `@effect/*`; their package exports resolve exclusively into `dist`.
3. Generate the Playwright injected runtime at build time, retain its license attribution, and move
   `playwright-core` to development dependencies only after every preview-automation path is covered.
4. Exclude non-target `node-pty` Windows prebuild directories while retaining the host architecture
   and the separately staged matching WSL prebuild.

## Verification

- Rebuild with the identical version/output settings and compare byte-for-byte categories.
- Run packaging tests and the focused desktop release smoke check.
- Launch the packaged app with isolated state; exercise primary backend, WSL preflight where
  available, preview automation, terminal, and one real Codex turn.
- No feature is removed merely to reduce size.

## Implemented result

The optimized x64 NSIS build used the same version and build command as the clean-main baseline:

- installer: 154,501,547 -> 133,860,393 bytes;
- installer size: 147.34 -> 127.66 MiB;
- saved: 20,641,154 bytes / 19.68 MiB / 13.36%;
- extracted payload: 412.15 MiB across 9,984 files.

The extracted installer contained zero source maps, `.d.mts`/`.d.cts` declarations, Effect source
trees, or `playwright-core` files. It retained the target x64 `node-pty` prebuilds, the embedded
Playwright injection source, and `THIRD-PARTY-NOTICES.md`.

The production desktop pack completed, the focused suite passed 74 tests, and the extracted app
completed a real isolated Codex turn (`CODEX_SMOKE_OK`). The benchmark environment did not provide a
Linux `node-pty` prebuild, so WSL startup was not exercised; the build emitted the same explicit WSL
warning as the baseline and the configuration test verifies that a supplied matching Linux prebuild
remains included.
