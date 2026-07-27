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
  COMPOSER_SEND_CELEBRATION_DURATION_MS,
  ComposerPrimaryActions,
  formatPendingPrimaryActionLabel,
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
