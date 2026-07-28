// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { RightPanelSurface } from "~/rightPanelStore";

import { RightPanelTabs } from "./RightPanelTabs";

function surfaces(): RightPanelSurface[] {
  return [
    { id: "s-diff", kind: "diff" },
    { id: "s-files", kind: "files" },
    { id: "s-agents", kind: "agents" },
  ] as unknown as RightPanelSurface[];
}

function baseProps(onActivate: (surface: RightPanelSurface) => void) {
  const noop = vi.fn();
  return {
    mode: "inline" as const,
    surfaces: surfaces(),
    activeSurfaceId: "s-files",
    pendingSurfaceIds: new Set<string>(),
    previewSessions: {},
    terminalLabelsById: new Map<string, string>(),
    onActivate,
    onCloseSurface: noop,
    onCloseOtherSurfaces: noop,
    onCloseSurfacesToRight: noop,
    onCloseAllSurfaces: noop,
    onCopyFilePath: noop,
    onAddBrowser: noop,
    onAddTerminal: noop,
    onAddDiff: noop,
    onAddFiles: noop,
    onAddAgents: noop,
    browserAvailable: true,
    diffAvailable: true,
    filesAvailable: true,
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  // base-ui / choreography hooks read these on client render; happy-dom omits
  // them by default.
  if (typeof window.matchMedia !== "function") {
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
  }
  if (typeof globalThis.ResizeObserver !== "function") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function tabByLabel(label: string): HTMLElement {
  const tabs = Array.from(container.querySelectorAll<HTMLElement>("[role='tab']"));
  const match = tabs.find((tab) => tab.textContent?.includes(label));
  if (!match) throw new Error(`tab "${label}" not found`);
  return match;
}

describe("RightPanelTabs optimistic activation", () => {
  it("selects the clicked tab synchronously, before the store echo changes the prop", () => {
    const onActivate = vi.fn();
    act(() => {
      root.render(
        <RightPanelTabs {...baseProps(onActivate)}>
          <div>panel body</div>
        </RightPanelTabs>,
      );
    });

    // Initial authoritative selection from the prop.
    expect(tabByLabel("Files").getAttribute("aria-selected")).toBe("true");
    expect(tabByLabel("Agents").getAttribute("aria-selected")).toBe("false");

    // A real click. The parent never re-renders (activeSurfaceId prop is frozen
    // at "s-files") and the store dispatch is deferred to the next frame, so this
    // asserts purely-local optimistic selection.
    act(() => {
      tabByLabel("Agents").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(tabByLabel("Agents").getAttribute("aria-selected")).toBe("true");
    expect(tabByLabel("Files").getAttribute("aria-selected")).toBe("false");
    // Selection did not wait on onActivate flowing back through activeSurfaceId.
    expect(tabByLabel("Agents").getAttribute("data-active-tab")).toBe("true");
  });

  it("reconciles to the authoritative prop when it changes externally", () => {
    const onActivate = vi.fn();
    act(() => {
      root.render(
        <RightPanelTabs {...baseProps(onActivate)}>
          <div>panel body</div>
        </RightPanelTabs>,
      );
    });

    act(() => {
      tabByLabel("Agents").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(tabByLabel("Agents").getAttribute("aria-selected")).toBe("true");

    // An external activation (e.g. store echo landing on a different surface)
    // wins over the optimistic local value.
    act(() => {
      root.render(
        <RightPanelTabs {...baseProps(onActivate)} activeSurfaceId="s-diff">
          <div>panel body</div>
        </RightPanelTabs>,
      );
    });
    expect(tabByLabel("Diff").getAttribute("aria-selected")).toBe("true");
    expect(tabByLabel("Agents").getAttribute("aria-selected")).toBe("false");
  });
});
