# Performance and package-size audit

Baseline commit: `37717bb8`

These plans cover the four independently measurable parts of the V3 Code performance audit.
No candidate is a confirmed diagnosis until its plan's benchmark gate passes.

| Priority | Plan                                                              | User-visible outcome                                                |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1        | [Runtime resource baselines](runtime-resource-baselines.md)       | Opening and using V3 Code no longer makes the whole PC lag          |
| 2        | [Streaming write amplification](streaming-write-amplification.md) | Active Codex responses use less backend CPU and disk I/O            |
| 3        | [Thread interaction latency](thread-interaction-latency.md)       | Clicks, sends, and warm/cold thread switches stay responsive        |
| 4        | [Installer payload](installer-payload.md)                         | Smaller installer and installed footprint without removing features |

Common controls:

- Windows x64, AC power, diagnostics panel closed.
- Isolated `T3CODE_HOME` and `APPDATA`; never use the live T3 database or Chrome profiles.
- Fabricated small and large thread histories, plus a controlled real Codex turn; no Claude turns.
- At least three measured repetitions, reporting median and p95 where the sample permits.
- Attribute Electron main/GPU/renderer/utility, backend, resource monitor, provider, Defender, and
  short-lived child processes separately.
- Build and runtime measurements compare the same commit/version and the same dataset/workload.
