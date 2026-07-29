// @vitest-environment happy-dom
//
// Lifecycle tests for the send-button celebration. The interesting behaviour is
// timing, not markup: a second send inside the first one's window has to make
// the class actually leave the DOM, or the browser never replays the keyframes.
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { COMPOSER_SEND_CELEBRATION_DURATION_MS } from "./ComposerPrimaryActions";
import { useSendCelebration } from "./ChatComposer";

type Celebration = ReturnType<typeof useSendCelebration>;

/**
 * Renders the hook in isolation. ChatComposer itself is thousands of lines of
 * provider-coupled UI, so the celebration contract is asserted through the
 * exported hook rather than by mounting the composer.
 */
function mountCelebration(): {
  latest: () => Celebration;
  states: boolean[];
  unmount: () => void;
} {
  const states: boolean[] = [];
  let latest: Celebration | null = null;

  function Probe() {
    const celebration = useSendCelebration();
    latest = celebration;
    states.push(celebration.isSendCelebrating);
    return null;
  }

  const container = document.createElement("div");
  document.body.append(container);
  let root: Root | null = null;
  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });

  return {
    latest: () => {
      if (!latest) {
        throw new Error("celebration probe never rendered");
      }
      return latest;
    },
    states,
    unmount: () => {
      act(() => {
        root?.unmount();
      });
      container.remove();
    },
  };
}

describe("useSendCelebration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts celebrating on trigger and settles itself if animationend never lands", () => {
    const probe = mountCelebration();

    act(() => {
      probe.latest().triggerSendCelebration();
    });
    expect(probe.latest().isSendCelebrating).toBe(true);

    act(() => {
      vi.advanceTimersByTime(COMPOSER_SEND_CELEBRATION_DURATION_MS + 50);
    });
    expect(probe.latest().isSendCelebrating).toBe(false);

    probe.unmount();
  });

  it("clears immediately when the arrow animation reports it finished", () => {
    const probe = mountCelebration();

    act(() => {
      probe.latest().triggerSendCelebration();
    });
    act(() => {
      probe.latest().finishSendCelebration();
    });
    expect(probe.latest().isSendCelebrating).toBe(false);

    // The safety-net timeout must have been cancelled, not merely outrun: a
    // surviving timer would re-clear state mid-way through the *next* send.
    act(() => {
      probe.latest().triggerSendCelebration();
    });
    act(() => {
      vi.advanceTimersByTime(COMPOSER_SEND_CELEBRATION_DURATION_MS);
    });
    expect(probe.latest().isSendCelebrating).toBe(true);

    probe.unmount();
  });

  it("drops the class for one frame so a mid-flight resend replays the keyframes", () => {
    const probe = mountCelebration();

    act(() => {
      probe.latest().triggerSendCelebration();
    });
    expect(probe.latest().isSendCelebrating).toBe(true);

    const before = probe.states.length;
    act(() => {
      probe.latest().triggerSendCelebration();
    });
    // Without this false commit the class never leaves the DOM and the browser
    // silently skips the second pulse.
    expect(probe.states.slice(before)).toContain(false);
    expect(probe.latest().isSendCelebrating).toBe(false);

    act(() => {
      vi.advanceTimersByTime(32);
    });
    expect(probe.latest().isSendCelebrating).toBe(true);

    // And the restarted run still ends on its own — no stuck state.
    act(() => {
      vi.advanceTimersByTime(COMPOSER_SEND_CELEBRATION_DURATION_MS + 50);
    });
    expect(probe.latest().isSendCelebrating).toBe(false);

    probe.unmount();
  });

  it("survives a burst of sends without leaking timers", () => {
    const probe = mountCelebration();

    for (let index = 0; index < 12; index += 1) {
      act(() => {
        probe.latest().triggerSendCelebration();
      });
      act(() => {
        vi.advanceTimersByTime(20);
      });
    }

    act(() => {
      vi.advanceTimersByTime(COMPOSER_SEND_CELEBRATION_DURATION_MS + 50);
    });
    expect(probe.latest().isSendCelebrating).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    probe.unmount();
  });

  it("cancels pending work on unmount", () => {
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const probe = mountCelebration();

    act(() => {
      probe.latest().triggerSendCelebration();
    });
    probe.unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    clearTimeoutSpy.mockRestore();
  });
});
