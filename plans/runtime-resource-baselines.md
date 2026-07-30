# Runtime resource baselines

## Problem

The user reports that the whole PC becomes laggy while V3 Code is working. CPU is visible, but RAM,
disk I/O, GPU/compositor load, process spawning, and Defender amplification can produce the same
symptom.

## Scope

- Desktop process tree and transient children
- `native/resource-monitor`
- Periodic server work such as preview port discovery, VCS refresh, and checkpoint/index refresh
- Windows Defender cost attributable to V3 Code's files and process spawning

## Evidence already established

- A controlled installed-app fixture with one visible running thread isolated the dominant
  continuous load to `.thread-status-trace`, the 16 px dashed SVG status icon:
  - normal motion: renderer + GPU averaged 55.69% of one CPU core;
  - only the SVG rotation enabled: 56.88%;
  - only the working-text pulse enabled: 6.45%;
  - all animation disabled: 0.61%.
- The Windows process-I/O counter fell with the animation, but it includes GPU IPC/shared-memory
  traffic and must not be reported as disk writes.
- `steps(8)` reduced combined renderer + GPU CPU to 15.70%, but a tightly sized HTML transform
  wrapper remained near 50% with or without `will-change: transform`. This Electron build did not
  compositor-promote either continuous rotation experiment.
- The row already retains three independent running cues without icon rotation: the dashed glyph,
  a pulsing literal `Working` label, and a duration that updates every second. Reduced-motion users
  already receive this static-icon treatment.
- Executable capability checks generated 188,130 trace spans across seven rotated files after
  startup plus renderer reconnects. The multiplicative source is the traced per-candidate
  `shell.isExecutableFile` helper, not a high steady-state lookup frequency.
- The native monitor samples the system process table at an adaptive cadence; the diagnostics panel
  increases its work and therefore must remain closed during external measurements.
- Preview port scanning can spawn PowerShell every three seconds, but only while retained.
- VCS and terminal subsystems have periodic refresh loops.
- `WorkspaceSearchIndex` passes the project `cwd` as `basePath`. The fff root/home flags permit those
  paths as project roots; they do not by themselves expand a normal project scan outside `cwd`.
  This candidate was independently rejected and needs no runtime fix.

## Benchmark gate

Capture process CPU, peak working set, read/write bytes, GPU engine utilization, process starts, and
Defender CPU for:

1. app idle with no running thread;
2. app idle while a thread is marked running;
3. one fabricated interaction;
4. one controlled real Codex turn;
5. diagnostics panel closed, open, then closed again.

Compare cold first launch separately from warmed steady state. Subtract the provider subtree from
the app-overhead result.

## Candidate changes, only if confirmed

- Keep the dashed working icon static. Preserve the existing working-text pulse, literal label,
  ticking duration, and reduced-motion behavior.
- Make `shell.isExecutableFile` an untraced helper while retaining the outer command-resolution
  spans. Do not add lookup caching or directory enumeration without separate evidence.
- Fix a telemetry retain-count leak only if the sample interval fails to return to background.
- Replace or slow the PowerShell port scan only if it materially contributes to the captured cost.
- Reduce continuous running-state animation only when reduced-motion/animation-disabled A/B testing
  materially lowers renderer or GPU cost.

## Verification

- Repeat the same scenarios after each change.
- Running-thread idle gate: renderer + GPU combined CPU should match the measured text-only floor
  (6.45% ± 1 percentage point of one core), sampled for at least 60 seconds.
- Resolver gate: equivalent capability refresh leaves outer resolution counts unchanged,
  `shell.isExecutableFile` spans at zero, and trace bytes down by more than 90%.
- Focused tests for the subsystem changed.
- No browser profile reuse and no live user database.

## Implemented result

The optimized production app was launched from the extracted benchmark installer with a fresh
Chromium profile and a copied fabricated fixture. The matched 15-second running-thread sample was:

- all V3 processes: 60.323% -> 7.253% of one CPU core (87.98% lower);
- renderer + GPU: 55.688% -> 7.150%;
- private working set: 759.07 MiB -> 628.17 MiB (suggestive only; single-run, GC-sensitive);
- running animations after the change: `sidebar-working-text` only.

A separate 60-second after-only stability sample averaged 9.576% of one core across all V3
processes. Renderer + GPU accounted for 8.66%; periodic server work accounted for another 0.74%.
This confirms the improvement persists, but it is not a matched before/after duration.

The copied trace baseline contained 273,826 `shell.isExecutableFile` leaf spans. During the
optimized run, 151 outer platform-resolution spans, 302 wrapper spans, and zero new leaf spans were
recorded. This verifies the instrumentation boundary change; it is not credited for the idle CPU
reduction.

Fable's adversarial review accepted the rotating SVG as the cause of the idle CPU regression because
the before-side ablations predicted the after result. It classified memory and cold-switch movements
as suggestive only and warm switching as a no-regression result.
