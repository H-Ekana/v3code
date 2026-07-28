// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { RightPanelSurface, RightPanelWorkspaceState } from "~/rightPanelStore";

import { RightPanelTabs } from "./RightPanelTabs";

const surfaces: RightPanelSurface[] = [
  { id: "diff", kind: "diff" },
  { id: "files", kind: "files" },
];

const workspace: RightPanelWorkspaceState = {
  layout: {
    type: "split",
    id: "split:test",
    axis: "horizontal",
    ratio: 0.5,
    first: { type: "pane", paneId: "pane:first" },
    second: { type: "pane", paneId: "pane:second" },
  },
  panes: {
    "pane:first": {
      id: "pane:first",
      surfaceIds: ["diff"],
      activeSurfaceId: "diff",
    },
    "pane:second": {
      id: "pane:second",
      surfaceIds: ["files"],
      activeSurfaceId: "files",
    },
  },
  focusedPaneId: "pane:first",
};

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let rectSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  rectSpy = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-right-panel-workspace")) return rect(0, 0, 1_000, 800);
      const pane = this.closest<HTMLElement>("[data-right-panel-pane]");
      const isSecondPane = pane?.dataset.rightPanelPane === "pane:second";
      if (this.hasAttribute("data-right-panel-tab-list")) {
        return rect(isSecondPane ? 500 : 0, 0, 500, 36);
      }
      if (this.hasAttribute("data-right-panel-pane")) {
        return rect(isSecondPane ? 500 : 0, 0, 500, 800);
      }
      if (this.getAttribute("role") === "tab") {
        return rect(isSecondPane ? 510 : 10, 4, 120, 28);
      }
      return rect(0, 0, 0, 0);
    });

  globalThis.ResizeObserver = class {
    readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: target.getBoundingClientRect(),
          } as ResizeObserverEntry,
        ],
        this,
      );
    }

    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  rectSpy.mockRestore();
  container.remove();
});

function dispatchPointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
    }),
  );
}

function renderWorkspace(
  onMoveSurface: (surface: RightPanelSurface, paneId: string) => void,
  onSplitSurface: (
    surface: RightPanelSurface,
    paneId: string,
    position: "top" | "right" | "bottom" | "left",
  ) => void,
) {
  const noop = vi.fn();
  act(() => {
    root.render(
      <RightPanelTabs
        mode="inline"
        surfaces={surfaces}
        workspace={workspace}
        activeSurfaceId="diff"
        pendingSurfaceIds={new Set()}
        previewSessions={{}}
        terminalLabelsById={new Map()}
        onActivate={noop}
        onCloseSurface={noop}
        onCloseOtherSurfaces={noop}
        onCloseSurfacesToRight={noop}
        onCloseAllSurfaces={noop}
        onCopyFilePath={noop}
        onAddBrowser={noop}
        onAddTerminal={noop}
        onAddDiff={noop}
        onAddFiles={noop}
        onAddAgents={noop}
        onMoveSurface={onMoveSurface}
        onSplitSurface={onSplitSurface}
        onFocusPane={noop}
        onSplitRatioChange={noop}
        browserAvailable
        diffAvailable
        filesAvailable
        renderSurface={(surface) => <div>{surface.id}</div>}
      >
        <div>legacy content</div>
      </RightPanelTabs>,
    );
  });
}

function dragFirstTabTo(x: number, y: number) {
  const tab = container.querySelector<HTMLElement>("#right-panel-pane-first-tab-0");
  if (!tab) throw new Error("Expected draggable tab");
  act(() => dispatchPointer(tab, "pointerdown", 50, 18));
  act(() => dispatchPointer(document, "pointermove", 60, 18));
  act(() => dispatchPointer(document, "pointermove", x, y));
  act(() => dispatchPointer(document, "pointerup", x, y));
}

describe("RightPanelTabs drag lifecycle", () => {
  it("resolves and commits a center drop using the mounted workspace bounds", () => {
    const onMoveSurface = vi.fn();
    renderWorkspace(onMoveSurface, vi.fn());
    dragFirstTabTo(750, 400);

    expect(onMoveSurface).toHaveBeenCalledWith(surfaces[0], "pane:second");
  });

  it("resolves and commits a pane-edge split", () => {
    const onSplitSurface = vi.fn();
    renderWorkspace(vi.fn(), onSplitSurface);
    dragFirstTabTo(510, 400);

    expect(onSplitSurface).toHaveBeenCalledWith(surfaces[0], "pane:second", "left");
  });
});
