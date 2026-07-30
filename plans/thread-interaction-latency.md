# Thread interaction latency

## Problem

Clicks, sends, and thread switches feel laggy, especially with long histories and active work.

## Evidence already established

- Controlled first visits scaled with snapshot size: about 111 ms for 20 activities, 309–379 ms for
  500 activities, and 968–974 ms for 2,000 activities. The first sequence produced ten 50–117 ms
  long tasks.
- A separate cold 2,000-activity profile took 945 ms wall time but only about 172 ms sampled
  renderer CPU and one 61 ms long task. The server snapshot took 105–118 ms; most wall time remains
  unattributed across transport, decode, JIT, and first paint.
- Once cached, 18 repeated switches averaged 89–91 ms with p95 123–126 ms and zero long tasks.
  Changing the running-icon animation did not materially change warm switch latency.
- Thread state has a five-minute idle TTL, and settled snapshots persist locally after load, so the
  measured warm path is the normal repeat-switch path.
- The timeline is already virtualized and memoized; lack of virtualization is not a valid diagnosis.
- Client publication is coalesced to roughly one React publication per frame, but reducer work still
  runs for each event.
- `threadReducer.ts` removes duplicates, appends, and fully sorts the complete activity array for
  every `thread.activity-appended`.
- `ChatView.tsx` derives several full-history views when thread messages or activities change.
- The repository's send-morph incident measured 200–400 ms main-thread stalls, but that historical
  result must be re-measured on the current implementation before treating it as current.

## Benchmark gate

Measure Chromium input-to-presentation latency, long tasks, React commit time, frame intervals, and
DOM-settle time for:

- ordinary sidebar click;
- warm and cold switches for 20-activity and 2,000-activity threads;
- send with text only and with an attachment;
- streaming into a large active thread.

Run normal-motion and reduced-motion/animation-disabled A/B trials to separate JavaScript/layout
cost from compositor/GPU cost.

## Candidate changes, only if confirmed

- Do not prefetch every sidebar thread, cap activity history, or claim a thread-switch fix from this
  synthetic cold fixture. Those changes spend CPU/memory or change cross-surface behavior without
  attributing most of the cold wall time.
- Add an ordered fast path for monotonically appended activities while preserving duplicate and
  out-of-order handling.
- Isolate or memoize full-history derivations identified by the production trace.
- Split an indivisible `ChatView` render boundary only if the trace still attributes long tasks to
  that component.
- Do not replace LegendList or rework the send animation unless current traces implicate them.

## Verification

- Focused reducer tests including duplicate IDs and shuffled sequences.
- Production desktop traces with the same fixture and action script before/after.
- Report warm and cold switch results separately.
- Treat the current cold result as a documented baseline, not a regression fix, until a trace
  attributes the currently unexplained wall time.

## Post-change measurement

- Warm 18-switch run: 90.29 ms mean, 89.21 ms median, 100.42 ms p95, and zero long tasks.
  This is a no-regression result against the 89-91 ms before mean; the p95 movement is not claimed as
  an improvement because the sample is small.
- One fresh-profile first visit to an unvisited 500-activity thread: 246.87 ms, zero long tasks.
- One fresh-profile first visit to an unvisited 2,000-activity thread: 326.40 ms, zero long tasks.

The cold results are suggestive only. They are single samples and the after app had a longer warm-up,
so OS, JIT, and renderer caches are aligned with the observed improvement. No cold-switch code change
is claimed.
