import { describe, expect, it } from "vite-plus/test";

import {
  WORKBENCH_CLOSE_ACKNOWLEDGMENT_MS,
  WORKBENCH_CONTENT_CROSSFADE_MS,
  WORKBENCH_CONTENT_CROSSFADE_PX,
  WORKBENCH_SURFACE_TRANSITION_MS,
  crossfadeOffsetPx,
  getFlipTranslateX,
  getKeyboardResizedHeight,
  getRovingTabIndex,
  getTabIndicatorMetrics,
  isSurfaceInert,
  isSurfaceTransitioning,
  nextSurfacePhase,
  resolveSurfaceTransitionDirection,
  shouldAcknowledgeTerminalClose,
  shouldRefitTerminal,
  terminalDrawerSeparatorProps,
  withClosingTerminalGhost,
  type SurfacePhase,
  type TerminalCloseAcknowledgmentInput,
} from "./workbenchChoreography";

describe("intensity budget", () => {
  it("keeps every duration inside the band the plan specifies for it", () => {
    // Plan item 13 "180–220ms exit" / item 16 "180–220ms surface launch and exit".
    expect(WORKBENCH_SURFACE_TRANSITION_MS).toBeGreaterThanOrEqual(180);
    expect(WORKBENCH_SURFACE_TRANSITION_MS).toBeLessThanOrEqual(220);
    // Plan item 13 "directionally crossfade panel content by about 4px over 150–180ms".
    expect(WORKBENCH_CONTENT_CROSSFADE_MS).toBeGreaterThanOrEqual(150);
    expect(WORKBENCH_CONTENT_CROSSFADE_MS).toBeLessThanOrEqual(180);
    expect(WORKBENCH_CONTENT_CROSSFADE_PX).toBe(4);
    // Plan item 16 "compact check/fade over roughly 180–220ms".
    expect(WORKBENCH_CLOSE_ACKNOWLEDGMENT_MS).toBeGreaterThanOrEqual(180);
    expect(WORKBENCH_CLOSE_ACKNOWLEDGMENT_MS).toBeLessThanOrEqual(220);
  });

  it("never translates panel content further than the Level 2 ceiling", () => {
    expect(Math.abs(crossfadeOffsetPx("forward"))).toBeLessThanOrEqual(4);
    expect(Math.abs(crossfadeOffsetPx("backward"))).toBeLessThanOrEqual(4);
    expect(crossfadeOffsetPx("none")).toBe(0);
  });
});

describe("nextSurfacePhase", () => {
  it("routes an open through entering and a close through exiting", () => {
    expect(nextSurfacePhase({ current: "closed", open: true, animate: true })).toBe("entering");
    expect(nextSurfacePhase({ current: "exiting", open: true, animate: true })).toBe("entering");
    expect(nextSurfacePhase({ current: "open", open: false, animate: true })).toBe("exiting");
    expect(nextSurfacePhase({ current: "entering", open: false, animate: true })).toBe("exiting");
  });

  it("is idempotent once settled, so a re-render cannot replay a one-shot", () => {
    expect(nextSurfacePhase({ current: "open", open: true, animate: true })).toBe("open");
    expect(nextSurfacePhase({ current: "closed", open: false, animate: true })).toBe("closed");
  });

  it("snaps without animating when the change is not user-initiated", () => {
    expect(nextSurfacePhase({ current: "closed", open: true, animate: false })).toBe("open");
    expect(nextSurfacePhase({ current: "open", open: false, animate: false })).toBe("closed");
  });

  it("makes closed and exiting content inert but never a launching surface", () => {
    const phases: SurfacePhase[] = ["closed", "entering", "open", "exiting"];
    // `entering` is absent on purpose: a launching panel is usable immediately,
    // so no meaningful content is hidden until an animation completes.
    expect(phases.filter(isSurfaceInert)).toEqual(["closed", "exiting"]);
    expect(phases.filter(isSurfaceTransitioning)).toEqual(["entering", "exiting"]);
  });
});

describe("tab strip", () => {
  it("resolves crossfade direction from the travelled index delta", () => {
    expect(resolveSurfaceTransitionDirection(0, 2)).toBe("forward");
    expect(resolveSurfaceTransitionDirection(2, 0)).toBe("backward");
    expect(resolveSurfaceTransitionDirection(1, 1)).toBe("none");
    expect(resolveSurfaceTransitionDirection(-1, 1)).toBe("none");
    expect(resolveSurfaceTransitionDirection(1, -1)).toBe("none");
  });

  it("moves the roving tabindex with wrap-around plus Home/End", () => {
    expect(getRovingTabIndex({ currentIndex: 0, key: "ArrowRight", count: 3 })).toBe(1);
    expect(getRovingTabIndex({ currentIndex: 2, key: "ArrowRight", count: 3 })).toBe(0);
    expect(getRovingTabIndex({ currentIndex: 0, key: "ArrowLeft", count: 3 })).toBe(2);
    expect(getRovingTabIndex({ currentIndex: 2, key: "Home", count: 3 })).toBe(0);
    expect(getRovingTabIndex({ currentIndex: 0, key: "End", count: 3 })).toBe(2);
  });

  it("leaves unrelated keys and empty strips to the browser", () => {
    expect(getRovingTabIndex({ currentIndex: 0, key: "Enter", count: 3 })).toBeNull();
    expect(getRovingTabIndex({ currentIndex: 0, key: "a", count: 3 })).toBeNull();
    expect(getRovingTabIndex({ currentIndex: 0, key: "ArrowRight", count: 0 })).toBeNull();
  });

  it("positions the indicator relative to the scrolling tab row", () => {
    expect(getTabIndicatorMetrics({ rowLeft: 100, tabLeft: 260, tabWidth: 96 })).toEqual({
      left: 160,
      width: 96,
    });
  });

  it("hides the indicator when the active tab has no measurable box", () => {
    expect(getTabIndicatorMetrics({ rowLeft: 0, tabLeft: 0, tabWidth: 0 })).toBeNull();
    expect(getTabIndicatorMetrics({ rowLeft: 0, tabLeft: 0, tabWidth: Number.NaN })).toBeNull();
  });
});

describe("getFlipTranslateX", () => {
  it("returns the inverse offset that puts the column back where it was", () => {
    expect(getFlipTranslateX(600, 400)).toBe(200);
    expect(getFlipTranslateX(400, 600)).toBe(-200);
  });

  it("ignores sub-pixel and non-finite movement so no animation is scheduled", () => {
    expect(getFlipTranslateX(400, 400.2)).toBe(0);
    expect(getFlipTranslateX(Number.NaN, 400)).toBe(0);
    expect(getFlipTranslateX(400, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("terminal drawer resize", () => {
  it("exposes horizontal separator semantics with the live value trio", () => {
    expect(terminalDrawerSeparatorProps({ height: 320, minHeight: 180, maxHeight: 800 })).toEqual({
      role: "separator",
      tabIndex: 0,
      "aria-orientation": "horizontal",
      "aria-label": "Resize terminal drawer",
      "aria-valuemin": 180,
      "aria-valuemax": 800,
      "aria-valuenow": 320,
    });
  });

  it("grows the drawer on ArrowUp because its handle sits on the top edge", () => {
    const base = { currentHeight: 300, minHeight: 180, maxHeight: 800 };
    expect(getKeyboardResizedHeight({ ...base, key: "ArrowUp" })).toBe(308);
    expect(getKeyboardResizedHeight({ ...base, key: "ArrowDown" })).toBe(292);
  });

  it("reuses the shared step, large-step, Home/End and clamping rules", () => {
    const base = { currentHeight: 300, minHeight: 180, maxHeight: 800 };
    expect(getKeyboardResizedHeight({ ...base, key: "ArrowUp", useLargeStep: true })).toBe(332);
    expect(getKeyboardResizedHeight({ ...base, key: "Home" })).toBe(180);
    expect(getKeyboardResizedHeight({ ...base, key: "End" })).toBe(800);
    expect(
      getKeyboardResizedHeight({
        currentHeight: 182,
        minHeight: 180,
        maxHeight: 800,
        key: "ArrowDown",
      }),
    ).toBe(180);
    expect(getKeyboardResizedHeight({ ...base, key: "PageUp" })).toBeNull();
  });
});

describe("shouldAcknowledgeTerminalClose", () => {
  const cleanUserClose: TerminalCloseAcknowledgmentInput = {
    cause: "user",
    status: "exited",
    exitCode: 0,
    exitSignal: null,
    hasRunningSubprocess: false,
  };

  it("acknowledges a user-initiated close of a cleanly exited session", () => {
    expect(shouldAcknowledgeTerminalClose(cleanUserClose)).toBe(true);
  });

  it("stays quiet for a background-session cleanup of the very same session", () => {
    expect(shouldAcknowledgeTerminalClose({ ...cleanUserClose, cause: "background-cleanup" })).toBe(
      false,
    );
  });

  it("stays quiet when the viewport auto-closes the tab after the process exits", () => {
    expect(shouldAcknowledgeTerminalClose({ ...cleanUserClose, cause: "session-exit" })).toBe(
      false,
    );
  });

  it("stays quiet for forced termination of a live session", () => {
    expect(shouldAcknowledgeTerminalClose({ ...cleanUserClose, status: "running" })).toBe(false);
    expect(shouldAcknowledgeTerminalClose({ ...cleanUserClose, status: "starting" })).toBe(false);
    expect(shouldAcknowledgeTerminalClose({ ...cleanUserClose, status: "closed" })).toBe(false);
  });

  it("stays quiet when the session died from a signal", () => {
    // SIGKILL: status can still settle to `exited`, so the signal is the tell.
    expect(shouldAcknowledgeTerminalClose({ ...cleanUserClose, exitSignal: 9 })).toBe(false);
  });

  it("stays quiet for a crash or a failing exit status", () => {
    expect(shouldAcknowledgeTerminalClose({ ...cleanUserClose, status: "error" })).toBe(false);
    expect(shouldAcknowledgeTerminalClose({ ...cleanUserClose, exitCode: 1 })).toBe(false);
    expect(shouldAcknowledgeTerminalClose({ ...cleanUserClose, exitCode: 130 })).toBe(false);
    expect(shouldAcknowledgeTerminalClose({ ...cleanUserClose, exitCode: null })).toBe(false);
  });

  it("stays quiet while a child process is still running", () => {
    expect(shouldAcknowledgeTerminalClose({ ...cleanUserClose, hasRunningSubprocess: true })).toBe(
      false,
    );
  });

  it("requires every clause at once — no single field can carry it", () => {
    const permutations: TerminalCloseAcknowledgmentInput[] = [
      { ...cleanUserClose, cause: "session-exit", status: "running" },
      { ...cleanUserClose, cause: "background-cleanup", exitCode: 0 },
      { ...cleanUserClose, status: "exited", exitCode: 0, exitSignal: 15 },
    ];
    for (const input of permutations) {
      expect(shouldAcknowledgeTerminalClose(input)).toBe(false);
    }
  });
});

describe("withClosingTerminalGhost", () => {
  it("re-inserts the closing tab at the slot it occupied", () => {
    expect(withClosingTerminalGhost(["a", "c"], { terminalId: "b", index: 1 })).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(withClosingTerminalGhost(["b", "c"], { terminalId: "a", index: 0 })).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns the list untouched when there is no ghost", () => {
    const ids = ["a", "b"];
    expect(withClosingTerminalGhost(ids, null)).toBe(ids);
  });

  it("does not duplicate a tab the store has not dropped yet", () => {
    const ids = ["a", "b"];
    expect(withClosingTerminalGhost(ids, { terminalId: "b", index: 1 })).toBe(ids);
  });

  it("clamps an out-of-range slot instead of producing holes", () => {
    expect(withClosingTerminalGhost(["a"], { terminalId: "z", index: 9 })).toEqual(["a", "z"]);
    expect(withClosingTerminalGhost(["a"], { terminalId: "z", index: -4 })).toEqual(["z", "a"]);
  });
});

describe("shouldRefitTerminal", () => {
  it("refuses a height-driven refit while the pointer is still dragging", () => {
    expect(shouldRefitTerminal({ reason: "height-settled", dragging: true })).toBe(false);
  });

  it("collapses a 60-frame drag into exactly one refit", () => {
    // Mirrors the drawer's funnel: every height change during a drag arrives as
    // "height-settled" with the pointer still down, and pointer-up is the one
    // checkpoint. If this ever returns more than one entry, xterm is being
    // refitted per animation frame.
    const refits: string[] = [];
    const attempt = (
      reason: Parameters<typeof shouldRefitTerminal>[0]["reason"],
      dragging: boolean,
    ) => {
      if (shouldRefitTerminal({ reason, dragging })) refits.push(reason);
    };

    for (let frame = 0; frame < 60; frame += 1) attempt("height-settled", true);
    attempt("drag-end", false);

    expect(refits).toEqual(["drag-end"]);
  });

  it("refits at every transition boundary and resize checkpoint", () => {
    const checkpoints = [
      "drag-end",
      "keyboard-resize",
      "window-resize",
      "visibility-enter",
      "transition-end",
    ] as const;
    for (const reason of checkpoints) {
      expect(shouldRefitTerminal({ reason, dragging: true })).toBe(true);
      expect(shouldRefitTerminal({ reason, dragging: false })).toBe(true);
    }
    expect(shouldRefitTerminal({ reason: "height-settled", dragging: false })).toBe(true);
  });
});
