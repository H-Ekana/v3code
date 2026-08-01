import { describe, expect, it } from "vite-plus/test";

import {
  STARTUP_SPLASH_FRAME_BUDGET_MS,
  summarizeStartupSplashBenchmark,
  type StartupSplashBenchmarkSample,
} from "./startupSplashBenchmark.test-support";

const smoothSample: StartupSplashBenchmarkSample = {
  armedAt: 100,
  appReadyAt: 420,
  exitStartedAt: 420,
  interactiveAt: 420,
  completedAt: 1_120,
  frameTimestamps: [420, 436, 453, 470, 486, 503],
  animationAttempts: 8,
  animationFailures: 0,
};

describe("startup splash benchmark", () => {
  it("summarizes the lifecycle and frame pacing from one shared time origin", () => {
    expect(summarizeStartupSplashBenchmark(smoothSample)).toEqual({
      totalMs: 1_020,
      readyWaitMs: 0,
      exitMs: 700,
      interactionBlockedMs: 320,
      p95FrameMs: 17,
      longestFrameMs: 17,
      droppedFrameRatio: 0,
      animationFailureRate: 0,
    });
  });

  it("counts visibly late frames and animation failures", () => {
    const summary = summarizeStartupSplashBenchmark({
      ...smoothSample,
      frameTimestamps: [420, 436, 470, 486, 536],
      animationAttempts: 10,
      animationFailures: 2,
    });

    expect(summary.p95FrameMs).toBe(50);
    expect(summary.longestFrameMs).toBe(50);
    expect(summary.droppedFrameRatio).toBe(0.5);
    expect(summary.animationFailureRate).toBe(0.2);
  });

  it("supports a stricter frame budget for high-refresh displays", () => {
    const summary = summarizeStartupSplashBenchmark(smoothSample, 1000 / 120);

    expect(STARTUP_SPLASH_FRAME_BUDGET_MS).toBeCloseTo(16.67, 2);
    expect(summary.droppedFrameRatio).toBe(1);
  });

  it("rejects impossible lifecycle order instead of publishing misleading metrics", () => {
    expect(() =>
      summarizeStartupSplashBenchmark({
        ...smoothSample,
        exitStartedAt: smoothSample.appReadyAt - 1,
      }),
    ).toThrow("exitStartedAt must not precede appReadyAt");

    expect(() =>
      summarizeStartupSplashBenchmark({
        ...smoothSample,
        frameTimestamps: [420, 419],
      }),
    ).toThrow("frame timestamps must be monotonic");

    expect(() =>
      summarizeStartupSplashBenchmark({
        ...smoothSample,
        animationAttempts: 1,
        animationFailures: 2,
      }),
    ).toThrow("animation counts must be non-negative integers with failures <= attempts");
  });

  it("handles runs with no frame or animation samples", () => {
    expect(
      summarizeStartupSplashBenchmark({
        ...smoothSample,
        frameTimestamps: [],
        animationAttempts: 0,
      }),
    ).toMatchObject({
      p95FrameMs: 0,
      longestFrameMs: 0,
      droppedFrameRatio: 0,
      animationFailureRate: 0,
    });
  });
});
