// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { FILES_CROSSFADE_MS } from "~/lib/filesDiffsMotion";

import { StateCrossfade } from "./StateCrossfade";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: React.ReactNode): void {
  act(() => root.render(node));
}

describe("StateCrossfade", () => {
  it("keeps the outgoing content mounted while the incoming content animates in", () => {
    render(
      <StateCrossfade contentKey="loading">
        <p data-testid="loading">Loading</p>
      </StateCrossfade>,
    );
    expect(container.querySelector('[data-testid="loading"]')).not.toBeNull();

    render(
      <StateCrossfade contentKey="content">
        <p data-testid="content">Content</p>
      </StateCrossfade>,
    );

    // The whole point of the fix: the outgoing subtree is retained so the
    // handoff overlaps, instead of React deleting it in the same commit.
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
    const retained = container.querySelector('[data-testid="loading"]');
    expect(retained).not.toBeNull();

    const leavingLayer = container.querySelector(".files-crossfade-leaving");
    expect(leavingLayer).not.toBeNull();
    expect(leavingLayer?.contains(retained)).toBe(true);
    // The retained snapshot is out of the accessibility tree and inert.
    expect(leavingLayer?.getAttribute("aria-hidden")).toBe("true");
    expect(leavingLayer?.hasAttribute("inert")).toBe(true);
  });

  it("carries the scope direction onto both the entering and the leaving layer", () => {
    render(
      <StateCrossfade contentKey="branch:files" direction="none">
        <p>Branch</p>
      </StateCrossfade>,
    );
    render(
      <StateCrossfade contentKey="turn-2:files" direction="forward">
        <p>Turn</p>
      </StateCrossfade>,
    );

    const entering = container.querySelector(".files-crossfade-entering");
    const leaving = container.querySelector(".files-crossfade-leaving");
    expect(entering?.getAttribute("data-diff-scope-direction")).toBe("forward");
    expect(leaving?.getAttribute("data-diff-scope-direction")).toBe("forward");
  });

  it("drops the retained layer once the crossfade window elapses", () => {
    vi.useFakeTimers();
    try {
      render(
        <StateCrossfade contentKey="loading">
          <p data-testid="loading">Loading</p>
        </StateCrossfade>,
      );
      render(
        <StateCrossfade contentKey="content">
          <p data-testid="content">Content</p>
        </StateCrossfade>,
      );
      expect(container.querySelector('[data-testid="loading"]')).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(FILES_CROSSFADE_MS + 20);
      });

      // Nothing expensive is retained beyond the animation window.
      expect(container.querySelector('[data-testid="loading"]')).toBeNull();
      expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
      expect(container.querySelector(".files-crossfade-leaving")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("carries the enter animation only during the window, then settles the live layer", () => {
    vi.useFakeTimers();
    try {
      render(
        <StateCrossfade contentKey="loading">
          <p data-testid="loading">Loading</p>
        </StateCrossfade>,
      );
      // First mount is not a handoff: the settled layer must not animate (and so
      // never composites a heavy first paint).
      expect(container.querySelector(".files-crossfade-entering")).toBeNull();

      render(
        <StateCrossfade contentKey="content">
          <p data-testid="content">Content</p>
        </StateCrossfade>,
      );

      // During the window the incoming layer animates in.
      const enteringDuringWindow = container.querySelector(".files-crossfade-entering");
      expect(enteringDuringWindow).not.toBeNull();
      expect(
        enteringDuringWindow?.contains(container.querySelector('[data-testid="content"]')),
      ).toBe(true);

      act(() => {
        vi.advanceTimersByTime(FILES_CROSSFADE_MS + 20);
      });

      // Once settled the live layer keeps NO enter-animation class, so no
      // finished opacity/transform animation lingers on this ancestor of the diff
      // scroller (the scroll regression this guards against).
      expect(container.querySelector(".files-crossfade-entering")).toBeNull();
      const settled = container.querySelector(".files-crossfade-layer");
      expect(settled).not.toBeNull();
      expect(settled?.className).not.toContain("files-crossfade-entering");
      expect(settled?.contains(container.querySelector('[data-testid="content"]'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates same-key content in place without retaining a stale layer", () => {
    render(
      <StateCrossfade contentKey="content">
        <p data-testid="body">First</p>
      </StateCrossfade>,
    );
    render(
      <StateCrossfade contentKey="content">
        <p data-testid="body">Second</p>
      </StateCrossfade>,
    );

    // A background refresh keeps the same key: it must not spawn a leaving layer.
    expect(container.querySelector(".files-crossfade-leaving")).toBeNull();
    expect(container.querySelector('[data-testid="body"]')?.textContent).toBe("Second");
  });
});
