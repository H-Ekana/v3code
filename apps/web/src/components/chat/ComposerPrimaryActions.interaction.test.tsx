// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The stop control reaches for the sidebar stage backdrop hook at the top of the
// component; stub it so the running branch renders without a provider.
vi.mock("../SidebarStageBackdrop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../SidebarStageBackdrop")>();
  return {
    ...actual,
    useSidebarStageBackdropVariant: () => null,
  };
});

import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import type { ComposerInterruptState } from "./ComposerPrimaryActions";

const baseProps = {
  compact: false,
  pendingAction: null,
  isRunning: true,
  showPlanFollowUpPrompt: false,
  promptHasText: false,
  isSendBusy: false,
  isConnecting: false,
  isEnvironmentUnavailable: false,
  isPreparingWorktree: false,
  hasSendableContent: false,
  onPreviousPendingQuestion: vi.fn(),
  onImplementPlanInNewThread: vi.fn(),
};

let container: HTMLDivElement;
let root: Root;

const mount = (interruptState: ComposerInterruptState, onInterrupt: () => void): void => {
  act(() => {
    root.render(
      createElement(ComposerPrimaryActions, { ...baseProps, interruptState, onInterrupt }),
    );
  });
};

const stopButton = (): HTMLButtonElement => {
  const button = container.querySelector<HTMLButtonElement>('[data-composer-stop-button="true"]');
  if (!button) throw new Error("stop button not rendered");
  return button;
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("stop control — live interaction", () => {
  it("carries the breathing glyph for the whole live turn, keyed on the running branch not pending", () => {
    mount("idle", vi.fn());
    const button = stopButton();
    // The glyph (the breathing white square — CSS animates it outside the
    // pending state) is present the entire time a turn runs (idle stop state).
    expect(button.querySelector(".composer-stop-button__glyph")).not.toBeNull();
    expect(button.getAttribute("data-stop-state")).toBe("idle");
    // Nothing pending-only has rendered yet.
    expect(button.querySelector(".composer-stop-button__trace")).toBeNull();
  });

  it("latches the press acknowledgment from pointerdown and fires the interrupt on click", () => {
    const onInterrupt = vi.fn();
    mount("idle", onInterrupt);
    const button = stopButton();

    // No press ack before the press.
    expect(button.getAttribute("data-stop-pressed")).toBeNull();

    act(() => {
      button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    // Acknowledged synchronously off the pointerdown, not off `:active`.
    expect(button.getAttribute("data-stop-pressed")).toBe("true");
    expect(button.querySelector(".composer-stop-button__press-ring")).not.toBeNull();

    act(() => {
      button.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });

  it("persists the press ack into the pending state and clears it only when the turn settles", () => {
    const onInterrupt = vi.fn();
    mount("idle", onInterrupt);
    const button = stopButton();

    act(() => {
      button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(button.getAttribute("data-stop-pressed")).toBe("true");

    // The stop machine advances to pending (parent-owned). The latch must hold.
    mount("pending", onInterrupt);
    const pending = stopButton();
    expect(pending.getAttribute("data-stop-pressed")).toBe("true");
    expect(pending.getAttribute("data-stop-state")).toBe("pending");
    // Pending owns the inner spinner; the outer running sweep is retired.
    expect(pending.querySelector(".composer-stop-button__trace")).not.toBeNull();
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(pending.hasAttribute("disabled")).toBe(true);

    // Turn settles back to idle: the press latch clears via the reset effect.
    mount("idle", onInterrupt);
    expect(stopButton().getAttribute("data-stop-pressed")).toBeNull();
  });
});
