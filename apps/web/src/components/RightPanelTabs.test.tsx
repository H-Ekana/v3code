import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { RightPanelSurface } from "~/rightPanelStore";

import { RightPanelTabs } from "./RightPanelTabs";

function surfaces(): RightPanelSurface[] {
  return [
    { id: "s-diff", kind: "diff" },
    { id: "s-files", kind: "files" },
    { id: "s-agents", kind: "agents" },
  ] as unknown as RightPanelSurface[];
}

function render(overrides: Partial<Parameters<typeof RightPanelTabs>[0]> = {}): string {
  const noop = vi.fn();
  return renderToStaticMarkup(
    <RightPanelTabs
      mode="inline"
      surfaces={surfaces()}
      activeSurfaceId="s-files"
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
      browserAvailable
      diffAvailable
      filesAvailable
      {...overrides}
    >
      <div>panel body</div>
    </RightPanelTabs>,
  );
}

describe("RightPanelTabs semantics", () => {
  it("uses tablist / tab / tabpanel roles", () => {
    const html = render();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-orientation="horizontal"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('id="right-panel-tabpanel"');
  });

  it("wires the active tab to the panel in both directions", () => {
    const html = render({ activeSurfaceId: "s-agents" });
    // Third surface -> index 2.
    expect(html).toContain('id="right-panel-tab-2"');
    expect(html).toContain('aria-controls="right-panel-tabpanel"');
    expect(html).toContain('aria-labelledby="right-panel-tab-2"');
  });

  it("keeps exactly one tab in the tab order (roving tabindex)", () => {
    const html = render();
    const tabSegments = html.split('role="tab"').slice(1);
    expect(tabSegments).toHaveLength(3);
    const selected = tabSegments.filter((segment) =>
      segment.slice(0, 200).includes('aria-selected="true"'),
    );
    expect(selected).toHaveLength(1);
    // One tabIndex="0" for the selected tab; the other two are -1.
    const zeroTabIndex = tabSegments.filter((segment) =>
      segment.slice(0, 200).includes('tabindex="0"'),
    );
    expect(zeroTabIndex).toHaveLength(1);
  });

  it("renders the moving indicator with the pink leading tip hook", () => {
    const html = render();
    expect(html).toContain('class="workbench-tab-indicator"');
    expect(html).toContain('data-tab-direction="none"');
    // Starts hidden so it cannot flash at 0,0 before the first measurement.
    expect(html).toContain("--workbench-tab-indicator-opacity:0");
  });

  it("omits the indicator when there are no surfaces", () => {
    const html = render({ surfaces: [], activeSurfaceId: null });
    expect(html).not.toContain('class="workbench-tab-indicator"');
    expect(html).toContain('role="tablist"');
  });

  it("marks the panel body as the crossfade target", () => {
    expect(render()).toContain("workbench-panel-content");
  });
});

describe("RightPanelTabs shell presence", () => {
  it("passes the phase to the shell and leaves an open panel interactive", () => {
    const html = render({ phase: "open" });
    expect(html).toContain('data-surface-phase="open"');
    expect(html).not.toContain("inert");
  });

  it("does not make a launching panel inert", () => {
    const html = render({ phase: "entering" });
    expect(html).toContain('data-surface-phase="entering"');
    expect(html).not.toContain("inert");
  });

  it("makes an exiting panel inert and hidden from assistive technology", () => {
    const html = render({ phase: "exiting" });
    expect(html).toContain('data-surface-phase="exiting"');
    expect(html).toContain("inert");
    expect(html).toContain('aria-hidden="true"');
  });

  it("never marks the shell as resizing at rest, so no animation is suppressed", () => {
    expect(render()).toContain('data-resizing="false"');
  });
});
