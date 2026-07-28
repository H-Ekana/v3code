import { describe, expect, it } from "vite-plus/test";

import {
  projectRightPanelDropPreview,
  projectedRightPanelSplitFits,
  resolveRightPanelDropIntent,
  rightPanelDropIntentId,
  type RightPanelDropGeometry,
  type RightPanelRect,
} from "./rightPanelDragLogic";
import type { RightPanelDropIntent, ThreadRightPanelState } from "./rightPanelStore";

function rect(left: number, top: number, width: number, height: number): RightPanelRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

function geometry(): RightPanelDropGeometry {
  const intents: RightPanelDropIntent[] = [
    {
      type: "move",
      targetPaneId: "pane:left",
      destination: "tab-strip",
    },
    {
      type: "move",
      targetPaneId: "pane:right",
      destination: "tab-strip",
    },
    { type: "move", targetPaneId: "pane:left", destination: "pane" },
    { type: "move", targetPaneId: "pane:right", destination: "pane" },
    ...(["top", "right", "bottom", "left"] as const).flatMap<RightPanelDropIntent>((position) => [
      { type: "split", target: "workspace", position },
      {
        type: "split",
        target: "pane",
        targetPaneId: "pane:left",
        position,
      },
      {
        type: "split",
        target: "pane",
        targetPaneId: "pane:right",
        position,
      },
    ]),
  ];
  return {
    workspace: rect(0, 0, 1_000, 800),
    panes: [
      { paneId: "pane:left", rect: rect(0, 0, 500, 800) },
      { paneId: "pane:right", rect: rect(500, 0, 500, 800) },
    ],
    docks: [
      { paneId: "pane:left", rect: rect(0, 0, 500, 36) },
      { paneId: "pane:right", rect: rect(500, 0, 500, 36) },
    ],
    enabledIntentIds: new Set(intents.map(rightPanelDropIntentId)),
  };
}

function twoPaneState(axis: "horizontal" | "vertical"): ThreadRightPanelState {
  return {
    isOpen: true,
    activeSurfaceId: "agents",
    surfaces: [
      { id: "browser:tab-a", kind: "preview", resourceId: "tab-a" },
      { id: "agents", kind: "agents" },
    ],
    layout: {
      type: "split",
      id: "split:root",
      axis,
      ratio: 0.5,
      first: { type: "pane", paneId: "pane:first" },
      second: { type: "pane", paneId: "pane:second" },
    },
    panes: {
      "pane:first": {
        id: "pane:first",
        surfaceIds: ["browser:tab-a"],
        activeSurfaceId: "browser:tab-a",
      },
      "pane:second": {
        id: "pane:second",
        surfaceIds: ["agents"],
        activeSurfaceId: "agents",
      },
    },
    focusedPaneId: "pane:second",
  };
}

describe("resolveRightPanelDropIntent", () => {
  it("prioritizes the actual tab strip over the workspace top edge", () => {
    expect(
      resolveRightPanelDropIntent({
        point: { x: 150, y: 12 },
        geometry: geometry(),
      }),
    ).toEqual({
      type: "move",
      targetPaneId: "pane:left",
      destination: "tab-strip",
    });
  });

  it("uses the outer workspace edge before a nested pane edge", () => {
    expect(
      resolveRightPanelDropIntent({
        point: { x: 995, y: 300 },
        geometry: geometry(),
      }),
    ).toEqual({ type: "split", target: "workspace", position: "right" });
  });

  it("selects one nearest leaf edge and otherwise resolves to its center", () => {
    expect(
      resolveRightPanelDropIntent({
        point: { x: 510, y: 400 },
        geometry: geometry(),
      }),
    ).toEqual({
      type: "split",
      target: "pane",
      targetPaneId: "pane:right",
      position: "left",
    });
    expect(
      resolveRightPanelDropIntent({
        point: { x: 750, y: 400 },
        geometry: geometry(),
      }),
    ).toEqual({
      type: "move",
      targetPaneId: "pane:right",
      destination: "pane",
    });
  });

  it("keeps the previous target through a small boundary deadband", () => {
    const previous: RightPanelDropIntent = {
      type: "split",
      target: "pane",
      targetPaneId: "pane:right",
      position: "left",
    };
    expect(
      resolveRightPanelDropIntent({
        point: { x: 630, y: 400 },
        geometry: geometry(),
        previousIntent: previous,
      }),
    ).toEqual(previous);
    expect(
      resolveRightPanelDropIntent({
        point: { x: 634, y: 400 },
        geometry: geometry(),
        previousIntent: previous,
      }),
    ).toEqual({
      type: "move",
      targetPaneId: "pane:right",
      destination: "pane",
    });
  });

  it("keeps a chosen workspace direction stable near a corner", () => {
    const previous: RightPanelDropIntent = {
      type: "split",
      target: "workspace",
      position: "bottom",
    };
    expect(
      resolveRightPanelDropIntent({
        point: { x: 995, y: 795 },
        geometry: geometry(),
        previousIntent: previous,
      }),
    ).toEqual(previous);
  });

  it("changes workspace direction when another corner edge is clearly closer", () => {
    const testGeometry = geometry();
    testGeometry.docks = [];
    expect(
      resolveRightPanelDropIntent({
        point: { x: 990, y: 1 },
        geometry: testGeometry,
        previousIntent: {
          type: "split",
          target: "workspace",
          position: "right",
        },
      }),
    ).toEqual({ type: "split", target: "workspace", position: "top" });
  });

  it("changes pane direction when another edge is clearly closer", () => {
    expect(
      resolveRightPanelDropIntent({
        point: { x: 600, y: 60 },
        geometry: geometry(),
        previousIntent: {
          type: "split",
          target: "pane",
          targetPaneId: "pane:right",
          position: "left",
        },
      }),
    ).toEqual({
      type: "split",
      target: "pane",
      targetPaneId: "pane:right",
      position: "top",
    });
  });
});

describe("projectRightPanelDropPreview", () => {
  it("previews the final full-height column after a stacked source collapses", () => {
    expect(
      projectRightPanelDropPreview({
        threadState: twoPaneState("vertical"),
        surfaceId: "agents",
        intent: {
          type: "split",
          target: "pane",
          targetPaneId: "pane:first",
          position: "right",
        },
      }),
    ).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
  });

  it("previews the final full-width row after a column source collapses", () => {
    expect(
      projectRightPanelDropPreview({
        threadState: twoPaneState("horizontal"),
        surfaceId: "agents",
        intent: {
          type: "split",
          target: "pane",
          targetPaneId: "pane:first",
          position: "bottom",
        },
      }),
    ).toEqual({ x: 0, y: 0.5, width: 1, height: 0.5 });
  });

  it("previews the expanded target pane after a center move collapses the source", () => {
    expect(
      projectRightPanelDropPreview({
        threadState: twoPaneState("horizontal"),
        surfaceId: "agents",
        intent: {
          type: "move",
          targetPaneId: "pane:first",
          destination: "pane",
        },
      }),
    ).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("uses tab-strip tint instead of a workspace preview when docking", () => {
    expect(
      projectRightPanelDropPreview({
        threadState: twoPaneState("horizontal"),
        surfaceId: "agents",
        intent: {
          type: "move",
          targetPaneId: "pane:first",
          destination: "tab-strip",
        },
      }),
    ).toBeNull();
  });

  it("checks split sizing against the post-collapse layout", () => {
    const state = twoPaneState("horizontal");
    if (state.layout?.type !== "split") throw new Error("Expected a split layout");
    state.layout = { ...state.layout, ratio: 0.3 };
    expect(
      projectedRightPanelSplitFits({
        threadState: state,
        surfaceId: "agents",
        intent: {
          type: "split",
          target: "pane",
          targetPaneId: "pane:first",
          position: "right",
        },
        workspaceWidth: 1_000,
        workspaceHeight: 800,
        minPaneWidth: 210,
        minPaneHeight: 150,
      }),
    ).toBe(true);
  });
});
