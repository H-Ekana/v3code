import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

const sidebarStage = vi.hoisted(() => ({ variant: "nightly" as "nightly" | "dev" | null }));

vi.mock("../SidebarStageBackdrop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../SidebarStageBackdrop")>();
  return {
    ...actual,
    useSidebarStageBackdropVariant: () => sidebarStage.variant,
  };
});

import {
  COMPOSER_INTERRUPT_UNCONFIRMED_TIMEOUT_MS,
  COMPOSER_SEND_CELEBRATION_DURATION_MS,
  type ComposerInterruptEvent,
  type ComposerInterruptState,
  ComposerPrimaryActions,
  canRequestComposerInterrupt,
  deriveStopControlPresentation,
  formatPendingPrimaryActionLabel,
  nextComposerInterruptState,
  shouldShowComposerSendSpinner,
} from "./ComposerPrimaryActions";

describe("formatPendingPrimaryActionLabel", () => {
  it("returns 'Submitting...' while responding", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: true,
        questionIndex: 0,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submitting...' while responding regardless of other flags", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: true,
        questionIndex: 3,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submit' in compact mode on the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit");
  });

  it("returns 'Next' in compact mode when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Next");
  });

  it("returns 'Next question' when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Next question");
  });

  it("returns singular 'Submit answer' on the last question when it is the only question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit answer");
  });

  it("returns plural 'Submit answers' on the last question when there are multiple questions", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Submit answers");
  });

  it("returns plural 'Submit answers' for higher question indices", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 5,
      }),
    ).toBe("Submit answers");
  });
});

describe("composer send button", () => {
  it("uses the brighter layered nightly cloud-and-star artwork", () => {
    sidebarStage.variant = "nightly";

    const markup = renderToStaticMarkup(
      createElement(ComposerPrimaryActions, {
        compact: false,
        pendingAction: null,
        isRunning: false,
        showPlanFollowUpPrompt: false,
        promptHasText: true,
        isSendBusy: false,
        isConnecting: false,
        isEnvironmentUnavailable: false,
        isPreparingWorktree: false,
        hasSendableContent: true,
        onPreviousPendingQuestion: vi.fn(),
        onInterrupt: vi.fn(),
        onImplementPlanInNewThread: vi.fn(),
      }),
    );

    expect(markup).toContain("composer-send-button--nightly");
    expect(markup).toContain("bg-[#2a245d]");
    expect(markup).toContain("data-nightly-send-art");
    expect(markup).toContain('viewBox="0 0 32 32"');
    expect(markup).toContain("nightly-send-clouds");
    expect(markup).toContain("nightly-send-stars");
    expect(markup).toContain("#F76DBB");
    expect(markup).not.toContain("M0 32H32V0L0 32Z");
    expect(markup).not.toContain("<image");
  });

  it("keeps the arrow visible while its send animation finishes", () => {
    expect(
      shouldShowComposerSendSpinner({
        isConnecting: false,
        isSendBusy: true,
        isSendArrowAnimating: true,
      }),
    ).toBe(false);
    expect(
      shouldShowComposerSendSpinner({
        isConnecting: false,
        isSendBusy: true,
        isSendArrowAnimating: false,
      }),
    ).toBe(true);
  });

  it("renders the same controlled celebration for every accepted send entry point", () => {
    const markup = renderToStaticMarkup(
      createElement(ComposerPrimaryActions, {
        compact: false,
        pendingAction: null,
        isRunning: false,
        showPlanFollowUpPrompt: false,
        promptHasText: true,
        isSendBusy: true,
        isConnecting: false,
        isEnvironmentUnavailable: false,
        isPreparingWorktree: false,
        hasSendableContent: true,
        isSendCelebrating: true,
        onPreviousPendingQuestion: vi.fn(),
        onInterrupt: vi.fn(),
        onImplementPlanInNewThread: vi.fn(),
        onSendCelebrationEnd: vi.fn(),
      }),
    );

    expect(COMPOSER_SEND_CELEBRATION_DURATION_MS).toBe(480);
    expect(markup).toContain("composer-send-button--sending");
    expect(markup).toContain("composer-send-arrow--sending");
    expect(markup).not.toContain('aria-label="Loading"');
  });
});

const ALL_INTERRUPT_STATES: ComposerInterruptState[] = ["idle", "pending", "failed", "unconfirmed"];

const renderStopButton = (interruptState: ComposerInterruptState) =>
  renderToStaticMarkup(
    createElement(ComposerPrimaryActions, {
      compact: false,
      pendingAction: null,
      isRunning: true,
      interruptState,
      showPlanFollowUpPrompt: false,
      promptHasText: false,
      isSendBusy: false,
      isConnecting: false,
      isEnvironmentUnavailable: false,
      isPreparingWorktree: false,
      hasSendableContent: false,
      onPreviousPendingQuestion: vi.fn(),
      onInterrupt: vi.fn(),
      onImplementPlanInNewThread: vi.fn(),
    }),
  );

describe("composer stop state contract", () => {
  it("moves to pending on press and stays pending on a repeat press", () => {
    expect(nextComposerInterruptState("idle", "press")).toBe("pending");
    expect(nextComposerInterruptState("pending", "press")).toBe("pending");
  });

  it("refuses a repeat stop request while one is already in flight", () => {
    expect(canRequestComposerInterrupt("idle")).toBe(true);
    expect(canRequestComposerInterrupt("pending")).toBe(false);
    // A failed or unconfirmed stop must be retryable.
    expect(canRequestComposerInterrupt("failed")).toBe(true);
    expect(canRequestComposerInterrupt("unconfirmed")).toBe(true);
  });

  it("restores the stop action when the interrupt request fails", () => {
    const state = nextComposerInterruptState("pending", "request-failed");
    expect(state).toBe("failed");
    const presentation = deriveStopControlPresentation(state);
    expect(presentation.disabled).toBe(false);
    expect(presentation.ariaBusy).toBe(false);
    expect(presentation.label).toContain("try again");
  });

  it("settles into idle once the turn stops running", () => {
    expect(nextComposerInterruptState("pending", "turn-settled")).toBe("idle");
    expect(nextComposerInterruptState("unconfirmed", "turn-settled")).toBe("idle");
    expect(nextComposerInterruptState("failed", "reset")).toBe("idle");
  });

  it("hands the stop action back when an accepted interrupt is never confirmed", () => {
    // The interrupted-turn wedge (KNOWN-ISSUES.md) can leave the session row
    // running forever; the watchdog is the only thing that unsticks the UI.
    expect(COMPOSER_INTERRUPT_UNCONFIRMED_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isFinite(COMPOSER_INTERRUPT_UNCONFIRMED_TIMEOUT_MS)).toBe(true);
    const state = nextComposerInterruptState("pending", "unconfirmed");
    expect(state).toBe("unconfirmed");
    expect(deriveStopControlPresentation(state).disabled).toBe(false);
  });

  it("cannot get stuck: pending is the only disabled state and every exit re-enables it", () => {
    const disabledStates = ALL_INTERRUPT_STATES.filter(
      (state) => deriveStopControlPresentation(state).disabled,
    );
    expect(disabledStates).toEqual(["pending"]);

    const exits: ComposerInterruptEvent[] = [
      "request-failed",
      "turn-settled",
      "unconfirmed",
      "reset",
    ];
    for (const event of exits) {
      const next = nextComposerInterruptState("pending", event);
      expect(deriveStopControlPresentation(next).disabled).toBe(false);
    }
  });

  it("announces the pending state politely instead of relying on the animation", () => {
    const pending = deriveStopControlPresentation("pending");
    expect(pending.ariaBusy).toBe(true);
    expect(pending.status).toBe("Stopping…");
    expect(deriveStopControlPresentation("idle").status).toBe("");
  });

  it("keeps the circular geometry stable across every stop state", () => {
    for (const state of ALL_INTERRUPT_STATES) {
      const markup = renderStopButton(state);
      expect(markup).toContain("composer-stop-button");
      expect(markup).toContain("size-8");
      expect(markup).toContain('role="status"');
      expect(markup).toContain("composer-stop-button__press-ring");
    }
  });

  it("swaps the stop square for an in-button trace only while pending", () => {
    const pending = renderStopButton("pending");
    expect(pending).toContain("composer-stop-button__trace");
    expect(pending).toContain('data-stop-state="pending"');
    expect(pending).toContain('disabled=""');
    expect(pending).toContain('aria-busy="true"');
    // The square is still in the DOM; CSS compresses it rather than unmounting.
    expect(pending).toContain("composer-stop-button__glyph");

    const idle = renderStopButton("idle");
    expect(idle).not.toContain("composer-stop-button__trace");
    expect(idle).not.toContain('disabled=""');
    expect(idle).toContain('aria-busy="false"');
  });
});
