import { describe, expect, it } from "vite-plus/test";
import {
  getRowBottom,
  resolveSentMessageRevealOffset,
  resolveTimelineEndSignal,
  resolveTimelineSendScroll,
} from "./timelineScrollAnchoring";

function buildState({
  positions,
  sizes,
  scroll = 0,
  scrollLength = 700,
}: {
  readonly positions: readonly number[];
  readonly sizes: readonly number[];
  readonly scroll?: number;
  readonly scrollLength?: number;
}) {
  return {
    data: positions.map((_, index) => index),
    scroll,
    scrollLength,
    positionAtIndex: (index: number) => positions[index],
    sizeAtIndex: (index: number) => sizes[index],
  };
}

describe("timeline scroll anchoring", () => {
  it("measures row bottoms from LegendList row position and size", () => {
    const state = buildState({
      positions: [0, 120],
      sizes: [80, 40],
    });

    expect(getRowBottom(state, 1)).toBe(160);
  });

  it("follows the live edge on send when the reader was at the end", () => {
    const decision = resolveTimelineSendScroll({ userWasAtEnd: true });
    expect(decision.mode).toBe("following-end");
    expect(decision.followOutput).toBe(true);
    expect(decision.isAtEnd).toBe(true);
  });

  it("holds the reader's place on send when they had scrolled up", () => {
    const decision = resolveTimelineSendScroll({ userWasAtEnd: false });
    expect(decision.mode).toBe("free-scrolling");
    expect(decision.followOutput).toBe(false);
    expect(decision.isAtEnd).toBe(false);
  });
});

describe("resolveSentMessageRevealOffset", () => {
  const base = {
    currentScroll: 0,
    scrollLength: 800,
    composerInset: 200,
    messageTop: 0,
    contentBottom: 0,
    anchorOffset: 16,
  };
  // usableViewport = 800 - 200 = 600

  it("scrolls by exactly the amount that puts the sent message above the composer", () => {
    // Message occupies 900..1000. Target = 1000 - 600 + 16 = 416.
    expect(
      resolveSentMessageRevealOffset({
        ...base,
        currentScroll: 300,
        messageTop: 900,
        contentBottom: 1000,
      }),
    ).toBe(416);
  });

  it("returns null when the message is already fully visible above the composer", () => {
    // Target = 1000 - 600 + 16 = 416; the reader is already there.
    expect(
      resolveSentMessageRevealOffset({
        ...base,
        currentScroll: 416,
        messageTop: 900,
        contentBottom: 1000,
      }),
    ).toBeNull();
  });

  it("ignores sub-pixel deltas", () => {
    expect(
      resolveSentMessageRevealOffset({
        ...base,
        currentScroll: 415.5,
        messageTop: 900,
        contentBottom: 1000,
      }),
    ).toBeNull();
  });

  it("top-aligns a message taller than the usable viewport (G2)", () => {
    // Message occupies 900..1700 (height 800 > 600 - 16). Target = 900 - 16.
    expect(
      resolveSentMessageRevealOffset({
        ...base,
        currentScroll: 300,
        messageTop: 900,
        contentBottom: 1700,
      }),
    ).toBe(884);
  });

  it("top-aligns as soon as the message no longer fits with breathing room", () => {
    // height 585 > 600 - 16 = 584 → top-align rather than reveal the end.
    expect(
      resolveSentMessageRevealOffset({
        ...base,
        currentScroll: 0,
        messageTop: 1000,
        contentBottom: 1585,
      }),
    ).toBe(984);
  });

  it("never scrolls backward when the reader already sits past the target (G4)", () => {
    // Target would be 416, but the reader is at 900 — max() keeps them put.
    expect(
      resolveSentMessageRevealOffset({
        ...base,
        currentScroll: 900,
        messageTop: 900,
        contentBottom: 1000,
      }),
    ).toBeNull();
  });

  it("returns null when the composer covers the whole viewport", () => {
    expect(
      resolveSentMessageRevealOffset({
        ...base,
        composerInset: 800,
        currentScroll: 100,
        messageTop: 900,
        contentBottom: 1000,
      }),
    ).toBeNull();
    expect(
      resolveSentMessageRevealOffset({
        ...base,
        composerInset: 1200,
        currentScroll: 100,
        messageTop: 900,
        contentBottom: 1000,
      }),
    ).toBeNull();
    expect(
      resolveSentMessageRevealOffset({
        ...base,
        scrollLength: 0,
        composerInset: 0,
        currentScroll: 100,
        messageTop: 900,
        contentBottom: 1000,
      }),
    ).toBeNull();
  });

  it("clamps a negative target to zero", () => {
    // Top-align branch with a message that starts inside the anchor offset:
    // messageTop - anchorOffset would be -8.
    expect(
      resolveSentMessageRevealOffset({
        ...base,
        currentScroll: 700,
        messageTop: 8,
        contentBottom: 1000,
      }),
    ).toBe(0);
  });

  it("never scrolls a short thread that already fits above the composer", () => {
    // contentBottom 100, target = max(currentScroll, 100 - 600 + 16) — the
    // reveal is a no-op at any scroll position because there is nothing to
    // reveal and it is forbidden to move backward.
    for (const currentScroll of [0, 40]) {
      expect(
        resolveSentMessageRevealOffset({
          ...base,
          currentScroll,
          messageTop: 0,
          contentBottom: 100,
        }),
      ).toBeNull();
    }
  });
});

describe("resolveTimelineEndSignal", () => {
  it("re-arms follow and clears the indicator on arrival at the live edge", () => {
    expect(
      resolveTimelineEndSignal({ isAtEnd: true, previousIsAtEnd: false, liveFollowArmed: false }),
    ).toEqual({
      nextIsAtEnd: true,
      enterFollowingEnd: true,
      enterFreeScrolling: false,
      hideNewTextIndicator: true,
    });
  });

  // The regression this helper exists for. A wheel gesture cancels live-follow
  // on every tick, so the reader can be sitting at the bottom with the mode
  // already dropped to free-scrolling AND the at-end flag still true. The old
  // `previousIsAtEnd === isAtEnd` early-return skipped the re-arm, stranding
  // the "a new text" bubble on screen with no way to dismiss it by scrolling.
  it("re-arms even when it already believed it was at the end", () => {
    const decision = resolveTimelineEndSignal({
      isAtEnd: true,
      previousIsAtEnd: true,
      liveFollowArmed: false,
    });
    expect(decision.enterFollowingEnd).toBe(true);
    expect(decision.hideNewTextIndicator).toBe(true);
    expect(decision.nextIsAtEnd).toBe(true);
  });

  it("stands down to free-scrolling when the reader leaves a settled edge", () => {
    expect(
      resolveTimelineEndSignal({ isAtEnd: false, previousIsAtEnd: true, liveFollowArmed: false }),
    ).toEqual({
      nextIsAtEnd: false,
      enterFollowingEnd: false,
      enterFreeScrolling: true,
      hideNewTextIndicator: false,
    });
  });

  it("does not re-enter free-scrolling when it was already free-scrolling", () => {
    const decision = resolveTimelineEndSignal({
      isAtEnd: false,
      previousIsAtEnd: false,
      liveFollowArmed: false,
    });
    expect(decision.enterFreeScrolling).toBe(false);
    expect(decision.hideNewTextIndicator).toBe(false);
  });

  // Content growing under a pinned viewport is programmatic drift, not the
  // reader opting out — keep following, just clear the signal.
  it("treats drift away from the edge while live-following as not opting out", () => {
    expect(
      resolveTimelineEndSignal({ isAtEnd: false, previousIsAtEnd: true, liveFollowArmed: true }),
    ).toEqual({
      nextIsAtEnd: true,
      enterFollowingEnd: false,
      enterFreeScrolling: false,
      hideNewTextIndicator: true,
    });
  });
});
