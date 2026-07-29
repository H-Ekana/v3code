# New installer instructions

How to build the V3 Code fork's Windows installer. Follow this whenever you are asked to
"create an installer" or "make an updater" for this repo.

There is no auto-updater for fork builds — by design. Shipping a new build means
producing a new installer `.exe` and having the user run it.

## 1. Naming scheme (get this right first)

Installer artifacts are named:

```
V3-Code-V3-<version>-<arch>.exe
```

where `<version>` is the upstream nightly base with a fork suffix appended:

```
<upstream-version>-nightly.<YYYYMMDD>.<build>.v3.<fork-semver>
```

Last shipped installer:

```
V3-Code-V3-0.0.30-nightly.20260728.933.v3.0.0.4-x64.exe
         └────────── upstream base ──────────┘ └ fork ┘
```

- upstream base: `0.0.30-nightly.20260728.933`
- fork suffix: `v3.0.0.4`

Rules for the next build:

1. **Increment the last numeral of the fork suffix.** After `v3.0.0.4` comes `v3.0.0.5`.
2. **Use the upstream nightly version the currently merged tree corresponds to.** Check:
   - `gh release list -R pingdotgg/t3code --limit 5`, or
   - the latest `-nightly.*` tag reachable from the merged `upstream/main`.
   - Plain fallback base if you truly cannot determine a nightly: the `version` field in
     `apps/server/package.json` (currently `0.0.30`) — this is also what the build script
     uses when no version is supplied.
3. The suffix must match `/\.v3\.\d+\.\d+\.\d+$/` exactly (four dot-separated numbers after
   `.v3` — i.e. `.v3.0.0.5`). Anything else is not recognized as a fork version.

## 2. Why the `.v3.X.Y.Z` suffix is mandatory

`scripts/build-desktop-artifact.ts` branches on `isV3ForkDesktopVersion(version)`
(`V3_FORK_VERSION_PATTERN`). When the suffix is present, `createBuildConfig`:

- sets `appId` to `com.v3code.desktop.v3` (instead of stock `com.v3code.desktop`), so the
  fork installs side-by-side and does not collide with an upstream install;
- sets `productName` to `V3 Code (V3 Preview)` (`resolveDesktopProductName`);
- sets `artifactName` to `V3-Code-V3-${version}-${arch}.${ext}`
  (`resolveDesktopArtifactName`);
- forces production branding assets/icons (`resolveDesktopWebAssetBrand`,
  `resolveDesktopBuildIconAssets` return `production` regardless of nightly channel);
- **disables the GitHub publish config**: `publishConfig = isV3Fork ? undefined : ...`, so
  no `publish` entry is written into the electron-builder config.

That last point is the critical one. Without the suffix the build produces a stock-identity
installer wired to upstream's GitHub update channel — installed copies would auto-update
themselves to `pingdotgg/t3code` releases and silently wipe the fork. **Never ship a build
whose version lacks the `.v3.X.Y.Z` suffix.**

## 3. Pre-build checklist

- **Consult the release ledger first**: `docs/project/installer-releases.md` is the
  authoritative record of the last shipped version — run `git pull` and take the top
  row's fork suffix plus one. Do not derive the last version from the local machine's
  installed app; other machines build installers too.
- Working tree is committed (the commit hash is baked into the artifact).
- `vendor/claude-plugins/codex` exists with `.claude-plugin/plugin.json` — the build
  hard-fails with `MissingBundledCodexPluginError` without it.
- The new version compares strictly higher than the previously shipped installer under
  semver prerelease ordering, so NSIS treats it as an upgrade rather than a reinstall.
  A newer nightly date wins; if the upstream base is unchanged, the bumped fork suffix wins.
- Do not run the build inside a sandbox that blocks native toolchains — the build compiles
  the Rust resource monitor and runs electron-builder.
- **No Rust toolchain?** The resource-monitor stage runs `cargo build` and fails with
  `spawn cargo ENOENT` if Rust is not installed. Escape hatch: place a prebuilt
  `t3-resource-monitor.exe` at
  `native/resource-monitor/target/x86_64-pc-windows-msvc/release/t3-resource-monitor.exe`
  and set `T3CODE_RESOURCE_MONITOR_USE_PREBUILT=1` for the build. Get the binary from the
  upstream nightly release **matching the merged upstream commit**: download the
  `T3-Code-<nightly>-x64.exe` asset, then extract with 7-Zip:
  `7z x <installer.exe> '$PLUGINSDIR/app-64.7z'` followed by
  `7z e app-64.7z resources/resource-monitor/t3-resource-monitor.exe`.
  Never reuse a binary from a different upstream version than the one merged.

## 4. Build command

**Windows-only.** All V3 Code machines run Windows: build ONLY the Windows NSIS `.exe`
(`dist:desktop:win`). Do not build the mac DMG, the Linux AppImage, or any other target
unless the user explicitly asks — they waste significant build time and cannot even
complete on a Windows host.

Run through pnpm so `vp` (vite-plus) is on PATH. A bare
`node scripts/build-desktop-artifact.ts` fails with `spawn vp ENOENT`.

The version is passed via the `T3CODE_DESKTOP_VERSION` env var:

```bash
T3CODE_DESKTOP_VERSION="0.0.31-nightly.20260729.946.v3.0.0.5" pnpm run dist:desktop:win
```

Substitute the upstream nightly base you resolved in step 1 — pick the nightly release
whose commit hash matches the upstream commit the tree was last merged from
(`gh release list -R pingdotgg/t3code --limit 5` shows the hash in each release title).
The example above is the next concrete version after the last shipped `v3.0.0.4`,
based on the 2026-07-29 merge of upstream commit `49c0d96ed`.

Script variants (`package.json`):

- `dist:desktop:win` — `--platform win --target nsis` (host default arch)
- `dist:desktop:win:x64` — pins x64
- `dist:desktop:win:arm64` — pins arm64

Output lands in `./release` (or `./release-mock` when mock updates are enabled).

Useful env vars, all read by `BuildEnvConfig`: `T3CODE_DESKTOP_VERBOSE=true` to stream
build output, `T3CODE_DESKTOP_KEEP_STAGE=true` to keep the staging dir for inspection,
`T3CODE_DESKTOP_OUTPUT_DIR` to redirect output.

## 5. Verify before handing it over

- The produced file is named `V3-Code-V3-<version>-<arch>.exe` — if the `-V3-` segment is
  missing, the suffix was wrong and the build is wired to upstream's update channel. Discard it.
- The version string in the filename is strictly higher than the previous installer.
- **Record the release**: append a row (newest first) to
  `docs/project/installer-releases.md` with the full version, upstream base + commit,
  and date, then commit and push it to `origin` right away. Skipping this strands the
  next agent (possibly on another machine) with a stale version number.

## 6. Updating users

Users update by running the newer installer over the existing install. There is no
auto-updater for fork builds and there should not be one — the publish config is
deliberately disabled so installed fork builds never pull upstream `pingdotgg/t3code`
releases.
