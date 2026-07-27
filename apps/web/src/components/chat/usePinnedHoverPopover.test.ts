import { describe, expect, it } from "vite-plus/test";

import {
  getPinnedHoverPopoverTransition,
  type PinnedHoverPopoverState,
} from "./usePinnedHoverPopover";

const CLOSED: PinnedHoverPopoverState = {
  open: false,
  pinned: false,
};

describe("getPinnedHoverPopoverTransition", () => {
  it("keeps a hover-open popover open and pins it when its trigger is clicked", () => {
    const hovered = getPinnedHoverPopoverTransition(CLOSED, {
      open: true,
      reason: "trigger-hover",
    });
    const clicked = getPinnedHoverPopoverTransition(hovered.state, {
      open: false,
      reason: "trigger-press",
    });
    const pointerLeft = getPinnedHoverPopoverTransition(clicked.state, {
      open: false,
      reason: "trigger-hover",
    });

    expect(clicked).toEqual({
      state: { open: true, pinned: true },
      cancelBaseTransition: true,
    });
    expect(pointerLeft).toEqual({
      state: { open: true, pinned: true },
      cancelBaseTransition: true,
    });
  });

  it("uses Base UI's matching transition when it already reflects the pinned state", () => {
    const quickPin = getPinnedHoverPopoverTransition(
      { open: true, pinned: false },
      {
        open: true,
        reason: "trigger-press",
      },
    );
    const close = getPinnedHoverPopoverTransition(
      { open: true, pinned: true },
      {
        open: false,
        reason: "trigger-press",
      },
    );

    expect(quickPin).toEqual({
      state: { open: true, pinned: true },
      cancelBaseTransition: false,
    });
    expect(close).toEqual({
      state: CLOSED,
      cancelBaseTransition: false,
    });
  });

  it("overrides Base UI when a patient-click transition conflicts with pinning", () => {
    const pin = getPinnedHoverPopoverTransition(
      { open: true, pinned: false },
      {
        open: false,
        reason: "trigger-press",
      },
    );
    const close = getPinnedHoverPopoverTransition(
      { open: true, pinned: true },
      {
        open: true,
        reason: "trigger-press",
      },
    );

    expect(pin).toEqual({
      state: { open: true, pinned: true },
      cancelBaseTransition: true,
    });
    expect(close).toEqual({
      state: CLOSED,
      cancelBaseTransition: true,
    });
  });

  it("opens and pins immediately when a closed trigger is clicked", () => {
    const clicked = getPinnedHoverPopoverTransition(CLOSED, {
      open: true,
      reason: "trigger-press",
    });

    expect(clicked).toEqual({
      state: { open: true, pinned: true },
      cancelBaseTransition: false,
    });
  });

  it("keeps hover-only and dismissal behavior ephemeral", () => {
    const hovered = getPinnedHoverPopoverTransition(CLOSED, {
      open: true,
      reason: "trigger-hover",
    });
    const pointerLeft = getPinnedHoverPopoverTransition(hovered.state, {
      open: false,
      reason: "trigger-hover",
    });
    const dismissed = getPinnedHoverPopoverTransition(
      { open: true, pinned: true },
      {
        open: false,
        reason: "outside-press",
      },
    );

    expect(hovered.state).toEqual({ open: true, pinned: false });
    expect(pointerLeft.state).toEqual(CLOSED);
    expect(dismissed.state).toEqual(CLOSED);
  });
});
