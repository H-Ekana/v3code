import {
  projectRightPanelDrop,
  selectThreadRightPanelWorkspace,
  type RightPanelDropIntent,
  type RightPanelLayoutNode,
  type RightPanelPaneId,
  type ThreadRightPanelState,
} from "./rightPanelStore";

export interface RightPanelPoint {
  x: number;
  y: number;
}

export interface RightPanelRect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface RightPanelDropGeometry {
  workspace: RightPanelRect;
  panes: ReadonlyArray<{ paneId: RightPanelPaneId; rect: RightPanelRect }>;
  docks: ReadonlyArray<{ paneId: RightPanelPaneId; rect: RightPanelRect }>;
  enabledIntentIds: ReadonlySet<string>;
}

const PANE_EDGE_RATIO = 0.25;
const INTENT_HYSTERESIS_PX = 7;
const WORKSPACE_EDGE_MIN_PX = 32;
const WORKSPACE_EDGE_MAX_PX = 56;
const WORKSPACE_EDGE_RATIO = 0.07;

function containsPoint(rect: RightPanelRect, point: RightPanelPoint, expansion = 0): boolean {
  return (
    point.x >= rect.left - expansion &&
    point.x < rect.right + expansion &&
    point.y >= rect.top - expansion &&
    point.y < rect.bottom + expansion
  );
}

function edgeDistance(
  rect: RightPanelRect,
  point: RightPanelPoint,
  position: "top" | "right" | "bottom" | "left",
): number {
  switch (position) {
    case "top":
      return point.y - rect.top;
    case "right":
      return rect.right - point.x;
    case "bottom":
      return rect.bottom - point.y;
    case "left":
      return point.x - rect.left;
  }
}

function workspaceEdgeBand(rect: RightPanelRect): number {
  return Math.max(
    WORKSPACE_EDGE_MIN_PX,
    Math.min(WORKSPACE_EDGE_MAX_PX, Math.min(rect.width, rect.height) * WORKSPACE_EDGE_RATIO),
  );
}

export function rightPanelDropIntentId(intent: RightPanelDropIntent): string {
  if (intent.type === "move") {
    return intent.destination === "tab-strip"
      ? `right-panel-dock:${intent.targetPaneId}`
      : `right-panel-drop:${intent.targetPaneId}:center`;
  }
  return intent.target === "workspace"
    ? `right-panel-workspace-drop:${intent.position}`
    : `right-panel-drop:${intent.targetPaneId}:${intent.position}`;
}

function intentIsEnabled(geometry: RightPanelDropGeometry, intent: RightPanelDropIntent): boolean {
  return geometry.enabledIntentIds.has(rightPanelDropIntentId(intent));
}

function workspaceIntent(position: "top" | "right" | "bottom" | "left"): RightPanelDropIntent {
  return { type: "split", target: "workspace", position };
}

function paneEdgeIntent(
  paneId: RightPanelPaneId,
  position: "top" | "right" | "bottom" | "left",
): RightPanelDropIntent {
  return { type: "split", target: "pane", targetPaneId: paneId, position };
}

function retainPreviousWorkspaceIntent(
  previous: RightPanelDropIntent | null,
  geometry: RightPanelDropGeometry,
  point: RightPanelPoint,
  band: number,
  closestEligibleDistance: number,
): RightPanelDropIntent | null {
  if (
    previous?.type !== "split" ||
    previous.target !== "workspace" ||
    !intentIsEnabled(geometry, previous)
  ) {
    return null;
  }
  const previousDistance = edgeDistance(geometry.workspace, point, previous.position);
  const isStillCompetitive =
    closestEligibleDistance === Number.POSITIVE_INFINITY ||
    previousDistance <= closestEligibleDistance + INTENT_HYSTERESIS_PX;
  return previousDistance <= band + INTENT_HYSTERESIS_PX && isStillCompetitive ? previous : null;
}

function retainPreviousPaneIntent(
  previous: RightPanelDropIntent | null,
  geometry: RightPanelDropGeometry,
  point: RightPanelPoint,
  paneId: RightPanelPaneId,
  closestEligibleEdgeDistance: number,
): RightPanelDropIntent | null {
  if (!previous || !intentIsEnabled(geometry, previous)) return null;
  const previousPaneId =
    previous.type === "move"
      ? previous.targetPaneId
      : previous.target === "pane"
        ? previous.targetPaneId
        : null;
  if (previousPaneId !== paneId) return null;
  const pane = geometry.panes.find((candidate) => candidate.paneId === paneId);
  if (!pane || !containsPoint(pane.rect, point, INTENT_HYSTERESIS_PX)) return null;

  if (previous.type === "move") {
    if (previous.destination !== "pane") return null;
    const horizontalBand = pane.rect.width * PANE_EDGE_RATIO;
    const verticalBand = pane.rect.height * PANE_EDGE_RATIO;
    const safelyCentered =
      edgeDistance(pane.rect, point, "left") >= horizontalBand - INTENT_HYSTERESIS_PX &&
      edgeDistance(pane.rect, point, "right") >= horizontalBand - INTENT_HYSTERESIS_PX &&
      edgeDistance(pane.rect, point, "top") >= verticalBand - INTENT_HYSTERESIS_PX &&
      edgeDistance(pane.rect, point, "bottom") >= verticalBand - INTENT_HYSTERESIS_PX;
    return safelyCentered ? previous : null;
  }

  if (previous.target !== "pane") return null;
  const threshold =
    previous.position === "left" || previous.position === "right"
      ? pane.rect.width * PANE_EDGE_RATIO
      : pane.rect.height * PANE_EDGE_RATIO;
  const previousDistance = edgeDistance(pane.rect, point, previous.position);
  const isStillCompetitive =
    closestEligibleEdgeDistance === Number.POSITIVE_INFINITY ||
    previousDistance <= closestEligibleEdgeDistance + INTENT_HYSTERESIS_PX;
  return previousDistance <= threshold + INTENT_HYSTERESIS_PX && isStillCompetitive
    ? previous
    : null;
}

export function resolveRightPanelDropIntent(input: {
  point: RightPanelPoint;
  geometry: RightPanelDropGeometry;
  previousIntent?: RightPanelDropIntent | null;
}): RightPanelDropIntent | null {
  const { point, geometry, previousIntent = null } = input;
  if (!containsPoint(geometry.workspace, point)) return null;

  const dock = geometry.docks
    .filter((candidate) => containsPoint(candidate.rect, point))
    .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)
    .find((candidate) =>
      intentIsEnabled(geometry, {
        type: "move",
        targetPaneId: candidate.paneId,
        destination: "tab-strip",
      }),
    );
  if (dock) {
    return {
      type: "move",
      targetPaneId: dock.paneId,
      destination: "tab-strip",
    };
  }

  const rootBand = workspaceEdgeBand(geometry.workspace);
  const workspaceCandidates = (["top", "right", "bottom", "left"] as const)
    .map((position) => ({
      intent: workspaceIntent(position),
      distance: edgeDistance(geometry.workspace, point, position),
    }))
    .filter(
      (candidate) =>
        candidate.distance >= 0 &&
        candidate.distance <= rootBand &&
        intentIsEnabled(geometry, candidate.intent),
    )
    .sort((a, b) => a.distance - b.distance);
  const retainedWorkspace = retainPreviousWorkspaceIntent(
    previousIntent,
    geometry,
    point,
    rootBand,
    workspaceCandidates[0]?.distance ?? Number.POSITIVE_INFINITY,
  );
  if (retainedWorkspace) return retainedWorkspace;

  if (workspaceCandidates[0]) return workspaceCandidates[0].intent;

  const pane = geometry.panes
    .filter((candidate) => containsPoint(candidate.rect, point))
    .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
  if (!pane) return null;

  const edgeCandidates = (["top", "right", "bottom", "left"] as const)
    .map((position) => {
      const threshold =
        position === "left" || position === "right"
          ? pane.rect.width * PANE_EDGE_RATIO
          : pane.rect.height * PANE_EDGE_RATIO;
      return {
        intent: paneEdgeIntent(pane.paneId, position),
        distance: edgeDistance(pane.rect, point, position),
        threshold,
      };
    })
    .filter(
      (candidate) =>
        candidate.distance >= 0 &&
        candidate.distance < candidate.threshold &&
        intentIsEnabled(geometry, candidate.intent),
    )
    .sort((a, b) => a.distance - b.distance);
  const retainedPane = retainPreviousPaneIntent(
    previousIntent,
    geometry,
    point,
    pane.paneId,
    edgeCandidates[0]?.distance ?? Number.POSITIVE_INFINITY,
  );
  if (retainedPane) return retainedPane;
  if (edgeCandidates[0]) return edgeCandidates[0].intent;

  const centerIntent: RightPanelDropIntent = {
    type: "move",
    targetPaneId: pane.paneId,
    destination: "pane",
  };
  return intentIsEnabled(geometry, centerIntent) ? centerIntent : null;
}

export interface RightPanelNormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function layoutRightPanelPanes(
  node: RightPanelLayoutNode,
  bounds: RightPanelNormalizedRect = { x: 0, y: 0, width: 1, height: 1 },
  result: Map<RightPanelPaneId, RightPanelNormalizedRect> = new Map(),
): ReadonlyMap<RightPanelPaneId, RightPanelNormalizedRect> {
  if (node.type === "pane") {
    result.set(node.paneId, bounds);
    return result;
  }
  if (node.axis === "horizontal") {
    layoutRightPanelPanes(node.first, { ...bounds, width: bounds.width * node.ratio }, result);
    layoutRightPanelPanes(
      node.second,
      {
        x: bounds.x + bounds.width * node.ratio,
        y: bounds.y,
        width: bounds.width * (1 - node.ratio),
        height: bounds.height,
      },
      result,
    );
  } else {
    layoutRightPanelPanes(node.first, { ...bounds, height: bounds.height * node.ratio }, result);
    layoutRightPanelPanes(
      node.second,
      {
        x: bounds.x,
        y: bounds.y + bounds.height * node.ratio,
        width: bounds.width,
        height: bounds.height * (1 - node.ratio),
      },
      result,
    );
  }
  return result;
}

export function projectRightPanelDropPreview(input: {
  threadState: ThreadRightPanelState;
  surfaceId: string;
  intent: RightPanelDropIntent;
}): RightPanelNormalizedRect | null {
  if (input.intent.type === "move" && input.intent.destination === "tab-strip") {
    return null;
  }

  let previewId = 0;
  const projected = projectRightPanelDrop(
    input.threadState,
    input.surfaceId,
    input.intent,
    (prefix) => `preview:${prefix}:${++previewId}`,
  );
  if (projected === input.threadState) return null;
  const workspace = selectThreadRightPanelWorkspace(projected);
  const targetPane = Object.values(workspace.panes).find((pane) =>
    pane.surfaceIds.includes(input.surfaceId),
  );
  if (!targetPane) return null;
  return layoutRightPanelPanes(workspace.layout).get(targetPane.id) ?? null;
}

export function projectedRightPanelSplitFits(input: {
  threadState: ThreadRightPanelState;
  surfaceId: string;
  intent: Extract<RightPanelDropIntent, { type: "split" }>;
  workspaceWidth: number;
  workspaceHeight: number;
  minPaneWidth: number;
  minPaneHeight: number;
}): boolean {
  const projectedRect = projectRightPanelDropPreview(input);
  if (!projectedRect) return false;
  return input.intent.position === "left" || input.intent.position === "right"
    ? projectedRect.width * input.workspaceWidth >= input.minPaneWidth
    : projectedRect.height * input.workspaceHeight >= input.minPaneHeight;
}
