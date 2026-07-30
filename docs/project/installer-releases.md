# Installer release ledger

The authoritative record of every V3 Code installer that has been built and shipped.
**Read this before choosing a version** (the next fork suffix is the last row's
`v3.X.Y.Z` plus one on the final numeral) and **append a row and push immediately after
a successful build**, so agents on other machines pick up the latest version with a
plain `git pull`. See `new-installer-instructions.md` for the full procedure.

Newest first.

| Full version                           | Fork suffix | Upstream base (commit)                      | Built      | Notes                                                                                                                                                                                                          |
| -------------------------------------- | ----------- | ------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0.0.31-nightly.20260729.946.v3.0.0.6` | v3.0.0.6    | `0.0.31-nightly.20260729.946` (`49c0d96ed`) | 2026-07-30 | Perf sweep (sidecar idle clamp, quiet server traces, renderer loop gating) + codex installer diet (playwright inline, node-pty prune, no sourcemaps → 134 MB, was 344 MB); Settings shows nightly + v3 version |
| `0.0.31-nightly.20260729.946.v3.0.0.5` | v3.0.0.5    | `0.0.31-nightly.20260729.946` (`49c0d96ed`) | 2026-07-29 | Upstream v0.0.30 merge; bundled Codex plugin; detached-job truthfulness; send-morph rewrite                                                                                                                    |
| `0.0.30-nightly.20260728.933.v3.0.0.4` | v3.0.0.4    | `0.0.30-nightly.20260728.933`               | 2026-07-28 | Last installer before the ledger existed (recovered from the artifact filename)                                                                                                                                |
