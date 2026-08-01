export const STARTUP_SPLASH_FRAME_BUDGET_MS = 1000 / 60;

export type StartupSplashBenchmarkSample = {
  readonly armedAt: number;
  readonly appReadyAt: number;
  readonly exitStartedAt: number;
  readonly interactiveAt: number;
  readonly completedAt: number;
  readonly frameTimestamps: readonly number[];
  readonly animationAttempts: number;
  readonly animationFailures: number;
};

export type StartupSplashBenchmarkSummary = {
  readonly totalMs: number;
  readonly readyWaitMs: number;
  readonly exitMs: number;
  readonly interactionBlockedMs: number;
  readonly p95FrameMs: number;
  readonly longestFrameMs: number;
  readonly droppedFrameRatio: number;
  readonly animationFailureRate: number;
};

function assertFiniteTimestamp(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite timestamp`);
  }
}

function nearestRank(values: readonly number[], percentile: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[rank] ?? 0;
}

export function summarizeStartupSplashBenchmark(
  sample: StartupSplashBenchmarkSample,
  frameBudgetMs = STARTUP_SPLASH_FRAME_BUDGET_MS,
): StartupSplashBenchmarkSummary {
  const lifecycle = [
    ["armedAt", sample.armedAt],
    ["appReadyAt", sample.appReadyAt],
    ["exitStartedAt", sample.exitStartedAt],
    ["interactiveAt", sample.interactiveAt],
    ["completedAt", sample.completedAt],
  ] as const;

  for (const [name, timestamp] of lifecycle) {
    assertFiniteTimestamp(name, timestamp);
  }
  if (sample.appReadyAt < sample.armedAt) {
    throw new Error("appReadyAt must not precede armedAt");
  }
  if (sample.exitStartedAt < sample.appReadyAt) {
    throw new Error("exitStartedAt must not precede appReadyAt");
  }
  if (sample.interactiveAt < sample.exitStartedAt) {
    throw new Error("interactiveAt must not precede exitStartedAt");
  }
  if (sample.completedAt < sample.interactiveAt) {
    throw new Error("completedAt must not precede interactiveAt");
  }
  if (!Number.isFinite(frameBudgetMs) || frameBudgetMs <= 0) {
    throw new Error("frameBudgetMs must be greater than zero");
  }
  if (
    !Number.isInteger(sample.animationAttempts) ||
    !Number.isInteger(sample.animationFailures) ||
    sample.animationAttempts < 0 ||
    sample.animationFailures < 0 ||
    sample.animationFailures > sample.animationAttempts
  ) {
    throw new Error("animation counts must be non-negative integers with failures <= attempts");
  }

  const frameIntervals = sample.frameTimestamps.slice(1).map((timestamp, index) => {
    const previousTimestamp = sample.frameTimestamps[index];
    assertFiniteTimestamp(`frameTimestamps[${index + 1}]`, timestamp);
    assertFiniteTimestamp(`frameTimestamps[${index}]`, previousTimestamp ?? Number.NaN);
    const interval = timestamp - (previousTimestamp ?? timestamp);
    if (interval < 0) {
      throw new Error("frame timestamps must be monotonic");
    }
    return interval;
  });
  const droppedFrameThresholdMs = frameBudgetMs * 1.5;
  const droppedFrameCount = frameIntervals.filter(
    (interval) => interval > droppedFrameThresholdMs,
  ).length;

  return {
    totalMs: sample.completedAt - sample.armedAt,
    readyWaitMs: sample.exitStartedAt - sample.appReadyAt,
    exitMs: sample.completedAt - sample.exitStartedAt,
    interactionBlockedMs: sample.interactiveAt - sample.armedAt,
    p95FrameMs: nearestRank(frameIntervals, 0.95),
    longestFrameMs: frameIntervals.length === 0 ? 0 : Math.max(...frameIntervals),
    droppedFrameRatio: frameIntervals.length === 0 ? 0 : droppedFrameCount / frameIntervals.length,
    animationFailureRate:
      sample.animationAttempts === 0 ? 0 : sample.animationFailures / sample.animationAttempts,
  };
}
