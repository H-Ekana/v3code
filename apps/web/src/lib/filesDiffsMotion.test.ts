import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  CHANGED_FILES_REVEAL_MAX_ENTRIES,
  FILES_SKELETON_DELAY_MS,
  diffScopeNavigationDirection,
  shouldRevealChangedFiles,
  startDeferredPending,
} from "./filesDiffsMotion";

describe("startDeferredPending", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never reveals a skeleton for a change that resolves from cache", () => {
    const elapsed = vi.fn();

    // Mount of the pending state.
    const cancel = startDeferredPending(true, FILES_SKELETON_DELAY_MS, elapsed);
    vi.advanceTimersByTime(FILES_SKELETON_DELAY_MS - 50);

    // Cached data arrives before the delay is up: React cleans the effect up
    // and re-runs it with `pending: false`.
    cancel();
    startDeferredPending(false, FILES_SKELETON_DELAY_MS, elapsed);
    vi.advanceTimersByTime(5_000);

    expect(elapsed).not.toHaveBeenCalledWith(true);
    expect(elapsed).toHaveBeenCalledWith(false);
  });

  it("reveals the skeleton once the pending state outlasts the delay", () => {
    const elapsed = vi.fn();

    startDeferredPending(true, FILES_SKELETON_DELAY_MS, elapsed);
    vi.advanceTimersByTime(FILES_SKELETON_DELAY_MS - 1);
    expect(elapsed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(elapsed).toHaveBeenCalledWith(true);
  });

  it("keeps the delay inside the planned 120-160ms window", () => {
    expect(FILES_SKELETON_DELAY_MS).toBeGreaterThanOrEqual(120);
    expect(FILES_SKELETON_DELAY_MS).toBeLessThanOrEqual(160);
  });

  it("reveals immediately when the delay is disabled", () => {
    const elapsed = vi.fn();

    startDeferredPending(true, 0, elapsed);

    expect(elapsed).toHaveBeenCalledWith(true);
  });

  it("clears the pending state synchronously when work finishes", () => {
    const elapsed = vi.fn();

    startDeferredPending(false, FILES_SKELETON_DELAY_MS, elapsed);

    expect(elapsed).toHaveBeenCalledExactlyOnceWith(false);
  });
});

describe("diffScopeNavigationDirection", () => {
  const order = ["unstaged", "branch", "turn:turn-3", "turn:turn-2", "turn:turn-1"];

  it("does not travel for the first scope of a session or a re-selection", () => {
    expect(diffScopeNavigationDirection(null, "branch", order)).toBe("none");
    expect(diffScopeNavigationDirection("branch", "branch", order)).toBe("none");
  });

  it("travels forward down the scope order and backward up it", () => {
    expect(diffScopeNavigationDirection("unstaged", "turn:turn-2", order)).toBe("forward");
    expect(diffScopeNavigationDirection("turn:turn-1", "unstaged", order)).toBe("backward");
    expect(diffScopeNavigationDirection("turn:turn-3", "turn:turn-1", order)).toBe("forward");
  });

  it("falls back to forward when a scope is not in the known order", () => {
    expect(diffScopeNavigationDirection("turn:gone", "branch", order)).toBe("forward");
    expect(diffScopeNavigationDirection("branch", "turn:unknown", order)).toBe("forward");
  });
});

describe("shouldRevealChangedFiles", () => {
  it("reveals a small changed-files container as one unit", () => {
    expect(shouldRevealChangedFiles(1)).toBe(true);
    expect(shouldRevealChangedFiles(CHANGED_FILES_REVEAL_MAX_ENTRIES)).toBe(true);
  });

  it("leaves large trees and empty containers unanimated", () => {
    expect(shouldRevealChangedFiles(CHANGED_FILES_REVEAL_MAX_ENTRIES + 1)).toBe(false);
    expect(shouldRevealChangedFiles(0)).toBe(false);
  });
});
