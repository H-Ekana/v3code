import { describe, expect, it } from "vite-plus/test";

import {
  createStartupSplashGate,
  STARTUP_SPLASH_FAILSAFE_MS,
  STARTUP_SPLASH_HOLD_MS,
  type StartupSplashExitReason,
} from "./startupSplash";

function createScheduledGate(options: { readonly visualReady?: boolean } = {}) {
  const canceled = new Set<number>();
  const timers = new Map<number, () => void>();
  const exits: StartupSplashExitReason[] = [];
  const gate = createStartupSplashGate({
    cancel: (timerId) => canceled.add(timerId),
    onExit: (reason) => exits.push(reason),
    schedule: (callback, delayMs) => {
      timers.set(delayMs, callback);
      return timers.size;
    },
    visualReady: options.visualReady,
  });

  return { canceled, exits, gate, timers };
}

describe("startup splash lifecycle gate", () => {
  it("uses one deterministic readiness gate regardless of signal order", () => {
    const appFirst = createScheduledGate({ visualReady: false });
    appFirst.gate.markAppReady();
    expect(appFirst.exits).toEqual([]);
    appFirst.gate.markVisualReady();
    expect(appFirst.exits).toEqual([]);
    appFirst.timers.get(STARTUP_SPLASH_HOLD_MS)?.();
    expect(appFirst.exits).toEqual(["ready"]);

    const visualFirst = createScheduledGate({ visualReady: false });
    visualFirst.gate.markVisualReady();
    visualFirst.timers.get(STARTUP_SPLASH_HOLD_MS)?.();
    expect(visualFirst.exits).toEqual([]);
    visualFirst.gate.markAppReady();
    expect(visualFirst.exits).toEqual(["ready"]);
  });

  it("skips immediately without waiting for readiness or the minimum frame", () => {
    const { canceled, exits, gate } = createScheduledGate({ visualReady: false });

    gate.skip();

    expect(exits).toEqual(["skip"]);
    expect(canceled.size).toBe(1);
  });

  it("reports the failsafe path when readiness never arrives", () => {
    const { exits, timers } = createScheduledGate({ visualReady: false });

    timers.get(STARTUP_SPLASH_HOLD_MS)?.();
    expect(exits).toEqual([]);
    timers.get(STARTUP_SPLASH_FAILSAFE_MS)?.();

    expect(exits).toEqual(["failsafe"]);
  });

  it("exits exactly once when late signals and timers race", () => {
    const { exits, gate, timers } = createScheduledGate({ visualReady: false });

    gate.skip();
    gate.skip();
    gate.markAppReady();
    gate.markVisualReady();
    timers.get(STARTUP_SPLASH_HOLD_MS)?.();
    timers.get(STARTUP_SPLASH_FAILSAFE_MS)?.();

    expect(exits).toEqual(["skip"]);
  });

  it("starts the minimum hold only after the splash is visually ready", () => {
    const { exits, gate, timers } = createScheduledGate({ visualReady: false });

    gate.markAppReady();
    expect(timers.has(STARTUP_SPLASH_HOLD_MS)).toBe(false);

    gate.markVisualReady();
    expect(timers.has(STARTUP_SPLASH_HOLD_MS)).toBe(true);
    expect(exits).toEqual([]);

    timers.get(STARTUP_SPLASH_HOLD_MS)?.();
    expect(exits).toEqual(["ready"]);
  });
});
