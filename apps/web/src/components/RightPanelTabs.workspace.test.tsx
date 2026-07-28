import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

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
    first: { type: "pane", paneId: "pane:root" },
    second: { type: "pane", paneId: "pane:second" },
  },
  panes: {
    "pane:root": {
      id: "pane:root",
      surfaceIds: ["diff"],
      activeSurfaceId: "diff",
    },
    "pane:second": {
      id: "pane:second",
      surfaceIds: ["files"],
      activeSurfaceId: "files",
    },
  },
  focusedPaneId: "pane:second",
};

function renderWorkspace(): string {
  const noop = vi.fn();
  return renderToStaticMarkup(
    <RightPanelTabs
      mode="inline"
      surfaces={surfaces}
      workspace={workspace}
      activeSurfaceId="files"
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
      onMoveSurface={noop}
      onSplitSurface={noop}
      onFocusPane={noop}
      onSplitRatioChange={noop}
      browserAvailable
      diffAvailable
      filesAvailable
      renderSurface={(surface) => <div>{`content:${surface.id}`}</div>}
    >
      <div>legacy content</div>
    </RightPanelTabs>,
  );
}

describe("RightPanelTabs recursive workspace", () => {
  it("renders every leaf pane and its active surface simultaneously", () => {
    const html = renderWorkspace();
    expect(html).toContain('data-right-panel-split="horizontal"');
    expect(html.match(/data-right-panel-pane=/g)).toHaveLength(2);
    expect(html).toContain("content:diff");
    expect(html).toContain("content:files");
    expect(html).not.toContain("legacy content");
  });

  it("gives each pane independent tab and tabpanel relationships", () => {
    const html = renderWorkspace();
    expect(html).toContain('id="right-panel-tabpanel"');
    expect(html).toContain('id="right-panel-pane-second-tabpanel"');
    expect(html).toContain('aria-controls="right-panel-pane-second-tabpanel"');
    expect(html).toContain('aria-labelledby="right-panel-pane-second-tab-0"');
  });
});
