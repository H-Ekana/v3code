/**
 * Thread-scoped right-panel surface state.
 *
 * This owns the ordered surface descriptors plus a recursive split tree whose
 * leaves are tab panes. Each feature still owns its durable resource state:
 * browser surfaces point at preview tab ids, terminal surfaces at terminal
 * session ids, file surfaces at workspace paths, and diff/plan/files remain
 * singleton surfaces.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export const RIGHT_PANEL_KINDS = [
  "plan",
  "diff",
  "files",
  "file",
  "preview",
  "terminal",
  "agents",
] as const;
export type RightPanelKind = (typeof RIGHT_PANEL_KINDS)[number];

export type RightPanelSurface =
  | { id: `browser:${string}`; kind: "preview"; resourceId: string }
  | { id: "browser:new"; kind: "preview"; resourceId: null }
  | {
      id: `terminal:${string}`;
      kind: "terminal";
      resourceId: string;
      terminalIds: string[];
      activeTerminalId: string;
      splitDirection?: "horizontal" | "vertical";
    }
  | { id: "diff"; kind: "diff" }
  | { id: "files"; kind: "files" }
  | {
      id: `file:${string}`;
      kind: "file";
      relativePath: string;
      revealLine: number | null;
      revealRequestId: number;
    }
  | { id: "plan"; kind: "plan" }
  | { id: "agents"; kind: "agents" };

export const RIGHT_PANEL_ROOT_PANE_ID = "pane:root";
export const RIGHT_PANEL_WORKSPACE_DROP_ID = "workspace:root";
export const RIGHT_PANEL_MAX_PANES = 4;

export type RightPanelPaneId = string;
export type RightPanelSplitAxis = "horizontal" | "vertical";
export type RightPanelDropPosition = "top" | "right" | "bottom" | "left" | "center";

export interface RightPanelPane {
  id: RightPanelPaneId;
  surfaceIds: string[];
  activeSurfaceId: string | null;
}

export type RightPanelLayoutNode =
  | { type: "pane"; paneId: RightPanelPaneId }
  | {
      type: "split";
      id: string;
      axis: RightPanelSplitAxis;
      ratio: number;
      first: RightPanelLayoutNode;
      second: RightPanelLayoutNode;
    };

export interface RightPanelWorkspaceState {
  layout: RightPanelLayoutNode;
  panes: Record<RightPanelPaneId, RightPanelPane>;
  focusedPaneId: RightPanelPaneId;
}

export type RightPanelDropIntent =
  | {
      type: "move";
      targetPaneId: RightPanelPaneId;
      destination: "pane" | "tab-strip";
    }
  | {
      type: "split";
      target: "pane";
      targetPaneId: RightPanelPaneId;
      position: Exclude<RightPanelDropPosition, "center">;
    }
  | {
      type: "split";
      target: "workspace";
      position: Exclude<RightPanelDropPosition, "center">;
    };

const RIGHT_PANEL_STORAGE_KEY = "t3code:right-panel-state:v2";
const RIGHT_PANEL_STORAGE_VERSION = 9;

export interface ThreadRightPanelState {
  isOpen: boolean;
  activeSurfaceId: string | null;
  surfaces: RightPanelSurface[];
  /**
   * Split workspace state is materialized lazily. Old/single-pane state stays
   * compact and migrates losslessly; the first split writes these three fields.
   */
  layout?: RightPanelLayoutNode;
  panes?: Record<RightPanelPaneId, RightPanelPane>;
  focusedPaneId?: RightPanelPaneId;
}

interface RightPanelStoreState {
  byThreadKey: Record<string, ThreadRightPanelState>;
  open: (ref: ScopedThreadRef, kind: Exclude<RightPanelKind, "file" | "terminal">) => void;
  openBrowser: (ref: ScopedThreadRef, tabId: string | null) => void;
  openFile: (ref: ScopedThreadRef, relativePath: string, line?: number) => void;
  openTerminal: (ref: ScopedThreadRef, terminalId: string) => void;
  splitTerminal: (
    ref: ScopedThreadRef,
    surfaceId: string,
    terminalId: string,
    direction?: "horizontal" | "vertical",
  ) => void;
  activateTerminal: (ref: ScopedThreadRef, surfaceId: string, terminalId: string) => void;
  closeTerminal: (ref: ScopedThreadRef, surfaceId: string, terminalId: string) => void;
  activateSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeOtherSurfaces: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeSurfacesToRight: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeAllSurfaces: (ref: ScopedThreadRef) => void;
  splitSurface: (
    ref: ScopedThreadRef,
    surfaceId: string,
    targetPaneId: RightPanelPaneId,
    position: Exclude<RightPanelDropPosition, "center">,
  ) => void;
  moveSurface: (ref: ScopedThreadRef, surfaceId: string, targetPaneId: RightPanelPaneId) => void;
  focusPane: (ref: ScopedThreadRef, paneId: RightPanelPaneId) => void;
  setSplitRatio: (ref: ScopedThreadRef, splitId: string, ratio: number) => void;
  reconcileBrowserSurfaces: (ref: ScopedThreadRef, tabIds: readonly string[]) => void;
  reconcileFileSurfaces: (ref: ScopedThreadRef, workspaceAvailable: boolean) => void;
  show: (ref: ScopedThreadRef) => void;
  close: (ref: ScopedThreadRef) => void;
  toggleVisibility: (ref: ScopedThreadRef) => void;
  toggle: (ref: ScopedThreadRef, kind: Exclude<RightPanelKind, "file" | "terminal">) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

const EMPTY_THREAD_STATE: ThreadRightPanelState = {
  isOpen: false,
  activeSurfaceId: null,
  surfaces: [],
};

let rightPanelLayoutId = 0;

function nextLayoutId(prefix: "pane" | "split"): string {
  rightPanelLayoutId += 1;
  return `${prefix}:${Date.now().toString(36)}:${rightPanelLayoutId.toString(36)}`;
}

type RightPanelLayoutIdFactory = (prefix: "pane" | "split") => string;

function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.max(0.15, Math.min(0.85, ratio));
}

function paneNode(paneId: RightPanelPaneId): RightPanelLayoutNode {
  return { type: "pane", paneId };
}

function collectLayoutPaneIds(node: RightPanelLayoutNode): RightPanelPaneId[] {
  if (node.type === "pane") return [node.paneId];
  return [...collectLayoutPaneIds(node.first), ...collectLayoutPaneIds(node.second)];
}

function mapLayoutNode(
  node: RightPanelLayoutNode,
  mapper: (node: RightPanelLayoutNode) => RightPanelLayoutNode,
): RightPanelLayoutNode {
  if (node.type === "pane") return mapper(node);
  return mapper({
    ...node,
    ratio: clampSplitRatio(node.ratio),
    first: mapLayoutNode(node.first, mapper),
    second: mapLayoutNode(node.second, mapper),
  });
}

function replacePaneNode(
  node: RightPanelLayoutNode,
  paneId: RightPanelPaneId,
  replacement: RightPanelLayoutNode,
): RightPanelLayoutNode {
  return mapLayoutNode(node, (candidate) =>
    candidate.type === "pane" && candidate.paneId === paneId ? replacement : candidate,
  );
}

function removePaneNode(
  node: RightPanelLayoutNode,
  paneId: RightPanelPaneId,
): RightPanelLayoutNode | null {
  if (node.type === "pane") return node.paneId === paneId ? null : node;
  const first = removePaneNode(node.first, paneId);
  const second = removePaneNode(node.second, paneId);
  if (!first) return second;
  if (!second) return first;
  return { ...node, ratio: clampSplitRatio(node.ratio), first, second };
}

function updateSplitRatio(
  node: RightPanelLayoutNode,
  splitId: string,
  ratio: number,
): RightPanelLayoutNode {
  if (node.type === "pane") return node;
  return {
    ...node,
    ratio: node.id === splitId ? clampSplitRatio(ratio) : clampSplitRatio(node.ratio),
    first: updateSplitRatio(node.first, splitId, ratio),
    second: updateSplitRatio(node.second, splitId, ratio),
  };
}

function paneContainingSurface(
  panes: Readonly<Record<RightPanelPaneId, RightPanelPane>>,
  surfaceId: string | null,
): RightPanelPaneId | null {
  if (!surfaceId) return null;
  return Object.values(panes).find((pane) => pane.surfaceIds.includes(surfaceId))?.id ?? null;
}

export function selectThreadRightPanelWorkspace(
  threadState: ThreadRightPanelState,
): RightPanelWorkspaceState {
  if (threadState.layout && threadState.panes && threadState.focusedPaneId) {
    return {
      layout: threadState.layout,
      panes: threadState.panes,
      focusedPaneId: threadState.focusedPaneId,
    };
  }
  return {
    layout: paneNode(RIGHT_PANEL_ROOT_PANE_ID),
    panes: {
      [RIGHT_PANEL_ROOT_PANE_ID]: {
        id: RIGHT_PANEL_ROOT_PANE_ID,
        surfaceIds: threadState.surfaces.map((surface) => surface.id),
        activeSurfaceId: threadState.activeSurfaceId,
      },
    },
    focusedPaneId: RIGHT_PANEL_ROOT_PANE_ID,
  };
}

function materializeWorkspace(threadState: ThreadRightPanelState): ThreadRightPanelState {
  const workspace = selectThreadRightPanelWorkspace(threadState);
  return {
    ...threadState,
    layout: workspace.layout,
    panes: workspace.panes,
    focusedPaneId: workspace.focusedPaneId,
  };
}

function reconcileMaterializedWorkspace(threadState: ThreadRightPanelState): ThreadRightPanelState {
  if (!threadState.layout || !threadState.panes || !threadState.focusedPaneId) {
    return threadState;
  }

  const validSurfaceIds = new Set<string>(threadState.surfaces.map((surface) => surface.id));
  const layoutPaneIds = collectLayoutPaneIds(threadState.layout);
  const seenSurfaceIds = new Set<string>();
  const panes: Record<RightPanelPaneId, RightPanelPane> = {};

  for (const paneId of layoutPaneIds.slice(0, RIGHT_PANEL_MAX_PANES)) {
    const source = threadState.panes[paneId];
    const surfaceIds = (source?.surfaceIds ?? []).filter((surfaceId) => {
      if (!validSurfaceIds.has(surfaceId) || seenSurfaceIds.has(surfaceId)) return false;
      seenSurfaceIds.add(surfaceId);
      return true;
    });
    panes[paneId] = {
      id: paneId,
      surfaceIds,
      activeSurfaceId:
        source?.activeSurfaceId && surfaceIds.includes(source.activeSurfaceId)
          ? source.activeSurfaceId
          : (surfaceIds[0] ?? null),
    };
  }

  let layout = threadState.layout;
  for (const paneId of layoutPaneIds) {
    if (!panes[paneId] || panes[paneId].surfaceIds.length === 0) {
      if (Object.keys(panes).filter((id) => panes[id]!.surfaceIds.length > 0).length > 0) {
        layout = removePaneNode(layout, paneId) ?? paneNode(RIGHT_PANEL_ROOT_PANE_ID);
        delete panes[paneId];
      }
    }
  }

  let remainingPaneIds = collectLayoutPaneIds(layout).filter((paneId) => panes[paneId]);
  if (remainingPaneIds.length === 0) {
    panes[RIGHT_PANEL_ROOT_PANE_ID] = {
      id: RIGHT_PANEL_ROOT_PANE_ID,
      surfaceIds: [],
      activeSurfaceId: null,
    };
    layout = paneNode(RIGHT_PANEL_ROOT_PANE_ID);
    remainingPaneIds = [RIGHT_PANEL_ROOT_PANE_ID];
  }

  const focusedPaneId = panes[threadState.focusedPaneId]
    ? threadState.focusedPaneId
    : (paneContainingSurface(panes, threadState.activeSurfaceId) ?? remainingPaneIds[0]!);

  for (const surface of threadState.surfaces) {
    if (seenSurfaceIds.has(surface.id)) continue;
    panes[focusedPaneId]!.surfaceIds.push(surface.id);
    seenSurfaceIds.add(surface.id);
  }

  const globalActivePaneId = paneContainingSurface(panes, threadState.activeSurfaceId);
  const resolvedFocusedPaneId = globalActivePaneId ?? focusedPaneId;
  const focusedPane = panes[resolvedFocusedPaneId]!;
  const activeSurfaceId =
    threadState.activeSurfaceId && focusedPane.surfaceIds.includes(threadState.activeSurfaceId)
      ? threadState.activeSurfaceId
      : focusedPane.activeSurfaceId;
  focusedPane.activeSurfaceId = activeSurfaceId;

  return {
    ...threadState,
    activeSurfaceId,
    layout,
    panes,
    focusedPaneId: resolvedFocusedPaneId,
  };
}

function splitWorkspaceSurface(
  threadState: ThreadRightPanelState,
  surfaceId: string,
  targetPaneId: RightPanelPaneId,
  position: Exclude<RightPanelDropPosition, "center">,
  createLayoutId: RightPanelLayoutIdFactory,
): ThreadRightPanelState {
  const materialized = materializeWorkspace(threadState);
  const layout = materialized.layout!;
  const panes = Object.fromEntries(
    Object.entries(materialized.panes!).map(([paneId, pane]) => [
      paneId,
      { ...pane, surfaceIds: [...pane.surfaceIds] },
    ]),
  );
  const sourcePaneId = paneContainingSurface(panes, surfaceId);
  const targetPane = panes[targetPaneId];
  if (!sourcePaneId || !targetPane) return threadState;

  const sourcePane = panes[sourcePaneId]!;
  if (sourcePaneId === targetPaneId && sourcePane.surfaceIds.length <= 1) {
    return threadState;
  }
  const projectedPaneCount = Object.keys(panes).length + (sourcePane.surfaceIds.length > 1 ? 1 : 0);
  if (projectedPaneCount > RIGHT_PANEL_MAX_PANES) return threadState;

  sourcePane.surfaceIds = sourcePane.surfaceIds.filter((id) => id !== surfaceId);
  if (sourcePane.activeSurfaceId === surfaceId) {
    sourcePane.activeSurfaceId = sourcePane.surfaceIds[0] ?? null;
  }

  let nextLayout = layout;
  if (sourcePane.surfaceIds.length === 0) {
    delete panes[sourcePaneId];
    nextLayout = removePaneNode(nextLayout, sourcePaneId) ?? paneNode(targetPaneId);
  }

  if (!panes[targetPaneId]) return threadState;
  const newPaneId = createLayoutId("pane");
  const newPane: RightPanelPane = {
    id: newPaneId,
    surfaceIds: [surfaceId],
    activeSurfaceId: surfaceId,
  };
  panes[newPaneId] = newPane;

  const newPaneNode = paneNode(newPaneId);
  const targetNode = paneNode(targetPaneId);
  const placeNewFirst = position === "top" || position === "left";
  const splitNode: RightPanelLayoutNode = {
    type: "split",
    id: createLayoutId("split"),
    axis: position === "left" || position === "right" ? "horizontal" : "vertical",
    ratio: 0.5,
    first: placeNewFirst ? newPaneNode : targetNode,
    second: placeNewFirst ? targetNode : newPaneNode,
  };

  return reconcileMaterializedWorkspace({
    ...materialized,
    isOpen: true,
    activeSurfaceId: surfaceId,
    layout: replacePaneNode(nextLayout, targetPaneId, splitNode),
    panes,
    focusedPaneId: newPaneId,
  });
}

function splitWorkspaceAtRoot(
  threadState: ThreadRightPanelState,
  surfaceId: string,
  position: Exclude<RightPanelDropPosition, "center">,
  createLayoutId: RightPanelLayoutIdFactory,
): ThreadRightPanelState {
  const materialized = materializeWorkspace(threadState);
  const panes = Object.fromEntries(
    Object.entries(materialized.panes!).map(([paneId, pane]) => [
      paneId,
      { ...pane, surfaceIds: [...pane.surfaceIds] },
    ]),
  );
  const sourcePaneId = paneContainingSurface(panes, surfaceId);
  if (!sourcePaneId || materialized.surfaces.length <= 1) return threadState;

  const sourcePane = panes[sourcePaneId]!;
  const projectedPaneCount = Object.keys(panes).length + (sourcePane.surfaceIds.length > 1 ? 1 : 0);
  if (projectedPaneCount > RIGHT_PANEL_MAX_PANES) return threadState;

  sourcePane.surfaceIds = sourcePane.surfaceIds.filter((id) => id !== surfaceId);
  if (sourcePane.activeSurfaceId === surfaceId) {
    sourcePane.activeSurfaceId = sourcePane.surfaceIds[0] ?? null;
  }

  let remainingLayout = materialized.layout!;
  if (sourcePane.surfaceIds.length === 0) {
    delete panes[sourcePaneId];
    const collapsedLayout = removePaneNode(remainingLayout, sourcePaneId);
    if (!collapsedLayout) return threadState;
    remainingLayout = collapsedLayout;
  }

  const newPaneId = createLayoutId("pane");
  panes[newPaneId] = {
    id: newPaneId,
    surfaceIds: [surfaceId],
    activeSurfaceId: surfaceId,
  };
  const placeNewFirst = position === "top" || position === "left";
  const splitNode: RightPanelLayoutNode = {
    type: "split",
    id: createLayoutId("split"),
    axis: position === "left" || position === "right" ? "horizontal" : "vertical",
    ratio: 0.5,
    first: placeNewFirst ? paneNode(newPaneId) : remainingLayout,
    second: placeNewFirst ? remainingLayout : paneNode(newPaneId),
  };

  return reconcileMaterializedWorkspace({
    ...materialized,
    isOpen: true,
    activeSurfaceId: surfaceId,
    layout: splitNode,
    panes,
    focusedPaneId: newPaneId,
  });
}

function moveWorkspaceSurface(
  threadState: ThreadRightPanelState,
  surfaceId: string,
  targetPaneId: RightPanelPaneId,
): ThreadRightPanelState {
  const materialized = materializeWorkspace(threadState);
  const panes = Object.fromEntries(
    Object.entries(materialized.panes!).map(([paneId, pane]) => [
      paneId,
      { ...pane, surfaceIds: [...pane.surfaceIds] },
    ]),
  );
  const sourcePaneId = paneContainingSurface(panes, surfaceId);
  const targetPane = panes[targetPaneId];
  if (!sourcePaneId || !targetPane) return threadState;

  if (sourcePaneId === targetPaneId) {
    if (materialized.activeSurfaceId === surfaceId && materialized.focusedPaneId === targetPaneId) {
      return threadState;
    }
    targetPane.activeSurfaceId = surfaceId;
    return {
      ...materialized,
      isOpen: true,
      activeSurfaceId: surfaceId,
      panes,
      focusedPaneId: targetPaneId,
    };
  }

  const sourcePane = panes[sourcePaneId]!;
  sourcePane.surfaceIds = sourcePane.surfaceIds.filter((id) => id !== surfaceId);
  if (sourcePane.activeSurfaceId === surfaceId) {
    sourcePane.activeSurfaceId = sourcePane.surfaceIds[0] ?? null;
  }
  targetPane.surfaceIds = [...targetPane.surfaceIds.filter((id) => id !== surfaceId), surfaceId];
  targetPane.activeSurfaceId = surfaceId;

  let layout = materialized.layout!;
  if (sourcePane.surfaceIds.length === 0) {
    delete panes[sourcePaneId];
    layout = removePaneNode(layout, sourcePaneId) ?? paneNode(targetPaneId);
  }

  return reconcileMaterializedWorkspace({
    ...materialized,
    isOpen: true,
    activeSurfaceId: surfaceId,
    layout,
    panes,
    focusedPaneId: targetPaneId,
  });
}

export function projectRightPanelDrop(
  threadState: ThreadRightPanelState,
  surfaceId: string,
  intent: RightPanelDropIntent,
  createLayoutId: RightPanelLayoutIdFactory = nextLayoutId,
): ThreadRightPanelState {
  if (intent.type === "move") {
    return moveWorkspaceSurface(threadState, surfaceId, intent.targetPaneId);
  }
  if (intent.target === "workspace") {
    return splitWorkspaceAtRoot(threadState, surfaceId, intent.position, createLayoutId);
  }
  return splitWorkspaceSurface(
    threadState,
    surfaceId,
    intent.targetPaneId,
    intent.position,
    createLayoutId,
  );
}

const singletonSurface = (
  kind: Exclude<RightPanelKind, "file" | "preview" | "terminal">,
): RightPanelSurface => {
  switch (kind) {
    case "diff":
      return { id: "diff", kind };
    case "files":
      return { id: "files", kind };
    case "plan":
      return { id: "plan", kind };
    case "agents":
      return { id: "agents", kind };
  }
};

const browserSurface = (tabId: string | null): RightPanelSurface =>
  tabId
    ? { id: `browser:${tabId}`, kind: "preview", resourceId: tabId }
    : { id: "browser:new", kind: "preview", resourceId: null };

const fileSurface = (
  relativePath: string,
  revealLine: number | null,
  revealRequestId: number,
): RightPanelSurface => ({
  id: `file:${relativePath}`,
  kind: "file",
  relativePath,
  revealLine,
  revealRequestId,
});

const terminalSurface = (terminalId: string): RightPanelSurface => ({
  id: `terminal:${terminalId}`,
  kind: "terminal",
  resourceId: terminalId,
  terminalIds: [terminalId],
  activeTerminalId: terminalId,
});

const upsertSurface = (
  current: ThreadRightPanelState,
  surface: RightPanelSurface,
  activate = true,
): ThreadRightPanelState => ({
  ...current,
  isOpen: true,
  surfaces: current.surfaces.some((entry) => entry.id === surface.id)
    ? current.surfaces
    : [...current.surfaces, surface],
  activeSurfaceId: activate ? surface.id : current.activeSurfaceId,
});

const updateThread = (
  byThreadKey: Record<string, ThreadRightPanelState>,
  threadKey: string,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
): Record<string, ThreadRightPanelState> => {
  const current = byThreadKey[threadKey] ?? EMPTY_THREAD_STATE;
  const updated = updater(current);
  const next = current.layout || updated.layout ? reconcileMaterializedWorkspace(updated) : updated;
  if (!next.isOpen && next.activeSurfaceId === null && next.surfaces.length === 0) {
    if (!(threadKey in byThreadKey)) return byThreadKey;
    const { [threadKey]: _removed, ...rest } = byThreadKey;
    return rest;
  }
  if (next === current) return byThreadKey;
  return { ...byThreadKey, [threadKey]: next };
};

function normalizeRevealLine(line: number | undefined): number | null {
  if (line === undefined || !Number.isFinite(line)) return null;
  return Math.max(1, Math.trunc(line));
}

export function migratePersistedRightPanelState(persistedState: unknown): {
  byThreadKey: Record<string, ThreadRightPanelState>;
} {
  if (!persistedState || typeof persistedState !== "object") {
    return { byThreadKey: {} };
  }
  const byThreadKey =
    "byThreadKey" in persistedState &&
    persistedState.byThreadKey &&
    typeof persistedState.byThreadKey === "object"
      ? Object.fromEntries(
          Object.entries(persistedState.byThreadKey as Record<string, ThreadRightPanelState>).map(
            ([threadKey, threadState]) => {
              const validThreadState =
                threadState && typeof threadState === "object" ? threadState : null;
              const surfaces = Array.isArray(validThreadState?.surfaces)
                ? validThreadState.surfaces.flatMap<RightPanelSurface>((surface) => {
                    if (surface.kind === "file") {
                      const revealLine =
                        typeof surface.revealLine === "number" &&
                        Number.isFinite(surface.revealLine)
                          ? Math.max(1, Math.trunc(surface.revealLine))
                          : null;
                      const revealRequestId =
                        typeof surface.revealRequestId === "number" &&
                        Number.isSafeInteger(surface.revealRequestId) &&
                        surface.revealRequestId >= 0
                          ? surface.revealRequestId
                          : 0;
                      return [{ ...surface, revealLine, revealRequestId }];
                    }
                    if (surface.kind !== "terminal") return [surface];
                    if (
                      !("resourceId" in surface) ||
                      typeof surface.resourceId !== "string" ||
                      surface.id !== `terminal:${surface.resourceId}`
                    ) {
                      return [];
                    }
                    const terminalIds =
                      "terminalIds" in surface && Array.isArray(surface.terminalIds)
                        ? [
                            ...new Set(
                              surface.terminalIds.filter(
                                (terminalId): terminalId is string =>
                                  typeof terminalId === "string",
                              ),
                            ),
                          ]
                        : [surface.resourceId];
                    const activeTerminalId =
                      "activeTerminalId" in surface &&
                      typeof surface.activeTerminalId === "string" &&
                      terminalIds.includes(surface.activeTerminalId)
                        ? surface.activeTerminalId
                        : (terminalIds[0] ?? surface.resourceId);
                    return [
                      {
                        ...surface,
                        terminalIds: terminalIds.length > 0 ? terminalIds : [surface.resourceId],
                        activeTerminalId,
                      },
                    ];
                  })
                : [];
              const activeSurfaceId = surfaces.some(
                (surface) => surface.id === validThreadState?.activeSurfaceId,
              )
                ? (validThreadState?.activeSurfaceId ?? null)
                : null;
              const isOpen =
                typeof validThreadState?.isOpen === "boolean"
                  ? validThreadState.isOpen
                  : activeSurfaceId !== null;
              return [threadKey, { isOpen, surfaces, activeSurfaceId }];
            },
          ),
        )
      : {};
  return { byThreadKey };
}

export const useRightPanelStore = create<RightPanelStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      open: (ref, kind) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            if (kind === "preview") {
              const existing = current.surfaces.find((surface) => surface.kind === "preview");
              return upsertSurface(current, existing ?? browserSurface(null));
            }
            return upsertSurface(current, singletonSurface(kind));
          }),
        })),
      openBrowser: (ref, tabId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const surface = browserSurface(tabId);
            const withoutPlaceholder = tabId
              ? current.surfaces.filter((entry) => entry.id !== "browser:new")
              : current.surfaces;
            return upsertSurface({ ...current, surfaces: withoutPlaceholder }, surface);
          }),
        })),
      openFile: (ref, relativePath, line) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const withoutStandaloneExplorer = current.surfaces.filter(
              (surface) => surface.kind !== "files",
            );
            const surfaceId = `file:${relativePath}` as const;
            const existing = withoutStandaloneExplorer.find(
              (surface): surface is Extract<RightPanelSurface, { kind: "file" }> =>
                surface.id === surfaceId && surface.kind === "file",
            );
            const surface = fileSurface(
              relativePath,
              normalizeRevealLine(line),
              (existing?.revealRequestId ?? 0) + 1,
            );
            return {
              ...current,
              isOpen: true,
              activeSurfaceId: surface.id,
              surfaces: existing
                ? withoutStandaloneExplorer.map((entry) =>
                    entry.id === surface.id ? surface : entry,
                  )
                : [...withoutStandaloneExplorer, surface],
            };
          }),
        })),
      openTerminal: (ref, terminalId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            upsertSurface(current, terminalSurface(terminalId)),
          ),
        })),
      splitTerminal: (ref, surfaceId, terminalId, direction = "horizontal") =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => ({
            ...current,
            isOpen: true,
            activeSurfaceId: surfaceId,
            surfaces: current.surfaces.map((surface) => {
              if (surface.id !== surfaceId || surface.kind !== "terminal") return surface;
              const { splitDirection: _splitDirection, ...baseSurface } = surface;
              return {
                ...baseSurface,
                terminalIds: surface.terminalIds.includes(terminalId)
                  ? surface.terminalIds
                  : [...surface.terminalIds, terminalId],
                activeTerminalId: terminalId,
                ...(direction === "vertical" ? { splitDirection: "vertical" as const } : {}),
              };
            }),
          })),
        })),
      activateTerminal: (ref, surfaceId, terminalId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => ({
            ...current,
            activeSurfaceId: surfaceId,
            surfaces: current.surfaces.map((surface) =>
              surface.id === surfaceId &&
              surface.kind === "terminal" &&
              surface.terminalIds.includes(terminalId)
                ? { ...surface, activeTerminalId: terminalId }
                : surface,
            ),
          })),
        })),
      closeTerminal: (ref, surfaceId, terminalId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const surface = current.surfaces.find(
              (entry) => entry.id === surfaceId && entry.kind === "terminal",
            );
            if (!surface || surface.kind !== "terminal") return current;
            const terminalIds = surface.terminalIds.filter((id) => id !== terminalId);
            if (terminalIds.length === 0) {
              const index = current.surfaces.findIndex((entry) => entry.id === surfaceId);
              const surfaces = current.surfaces.filter((entry) => entry.id !== surfaceId);
              const fallback = surfaces[Math.min(index, surfaces.length - 1)] ?? null;
              return {
                ...current,
                isOpen: surfaces.length > 0 && current.isOpen,
                surfaces,
                activeSurfaceId:
                  current.activeSurfaceId === surfaceId
                    ? (fallback?.id ?? null)
                    : current.activeSurfaceId,
              };
            }
            return {
              ...current,
              surfaces: current.surfaces.map((entry) =>
                entry.id === surfaceId && entry.kind === "terminal"
                  ? {
                      ...entry,
                      terminalIds,
                      activeTerminalId:
                        entry.activeTerminalId === terminalId
                          ? (terminalIds.at(-1) ?? terminalIds[0]!)
                          : entry.activeTerminalId,
                    }
                  : entry,
              ),
            };
          }),
        })),
      activateSurface: (ref, surfaceId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            current.surfaces.some((surface) => surface.id === surfaceId)
              ? { ...current, isOpen: true, activeSurfaceId: surfaceId }
              : current,
          ),
        })),
      closeSurface: (ref, surfaceId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            if (index < 0) return current;
            const surfaces = current.surfaces.filter((surface) => surface.id !== surfaceId);
            if (current.activeSurfaceId !== surfaceId) {
              return { ...current, isOpen: surfaces.length > 0 && current.isOpen, surfaces };
            }
            const fallback = surfaces[Math.min(index, surfaces.length - 1)] ?? null;
            return {
              ...current,
              isOpen: surfaces.length > 0 && current.isOpen,
              surfaces,
              activeSurfaceId: fallback?.id ?? null,
            };
          }),
        })),
      closeOtherSurfaces: (ref, surfaceId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const surface = current.surfaces.find((entry) => entry.id === surfaceId);
            if (!surface || current.surfaces.length === 1) return current;
            return {
              ...current,
              isOpen: true,
              surfaces: [surface],
              activeSurfaceId: surface.id,
            };
          }),
        })),
      closeSurfacesToRight: (ref, surfaceId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            if (index < 0 || index === current.surfaces.length - 1) return current;
            const surfaces = current.surfaces.slice(0, index + 1);
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            return {
              ...current,
              surfaces,
              activeSurfaceId: activeStillExists ? current.activeSurfaceId : surfaceId,
            };
          }),
        })),
      closeAllSurfaces: (ref) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            current.surfaces.length === 0
              ? current
              : { ...current, isOpen: false, surfaces: [], activeSurfaceId: null },
          ),
        })),
      splitSurface: (ref, surfaceId, targetPaneId, position) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            projectRightPanelDrop(
              current,
              surfaceId,
              targetPaneId === RIGHT_PANEL_WORKSPACE_DROP_ID
                ? { type: "split", target: "workspace", position }
                : {
                    type: "split",
                    target: "pane",
                    targetPaneId,
                    position,
                  },
            ),
          ),
        })),
      moveSurface: (ref, surfaceId, targetPaneId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            projectRightPanelDrop(current, surfaceId, {
              type: "move",
              targetPaneId,
              destination: "pane",
            }),
          ),
        })),
      focusPane: (ref, paneId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const materialized = materializeWorkspace(current);
            const pane = materialized.panes?.[paneId];
            if (!pane) return current;
            return {
              ...materialized,
              isOpen: true,
              focusedPaneId: paneId,
              activeSurfaceId: pane.activeSurfaceId,
            };
          }),
        })),
      setSplitRatio: (ref, splitId, ratio) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            if (!current.layout) return current;
            const layout = updateSplitRatio(current.layout, splitId, ratio);
            return layout === current.layout ? current : { ...current, layout };
          }),
        })),
      reconcileBrowserSurfaces: (ref, tabIds) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const validIds = new Set(tabIds.map((tabId) => `browser:${tabId}`));
            const nonBrowser = current.surfaces.filter((surface) => surface.kind !== "preview");
            const existingBrowser = current.surfaces.filter(
              (surface): surface is Extract<RightPanelSurface, { kind: "preview" }> =>
                surface.kind === "preview" &&
                surface.id !== "browser:new" &&
                validIds.has(surface.id),
            );
            const knownIds = new Set(existingBrowser.map((surface) => surface.id));
            const added = tabIds
              .filter((tabId) => !knownIds.has(`browser:${tabId}`))
              .map((tabId) => browserSurface(tabId));
            const surfaces = [...nonBrowser, ...existingBrowser, ...added];
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            const fallbackBrowser = surfaces.find((surface) => surface.kind === "preview");
            return {
              ...current,
              surfaces,
              activeSurfaceId: activeStillExists
                ? current.activeSurfaceId
                : (fallbackBrowser?.id ?? surfaces[0]?.id ?? null),
            };
          }),
        })),
      reconcileFileSurfaces: (ref, workspaceAvailable) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            if (workspaceAvailable) return current;
            const surfaces = current.surfaces.filter(
              (surface) => surface.kind !== "files" && surface.kind !== "file",
            );
            if (surfaces.length === current.surfaces.length) return current;
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            return {
              ...current,
              isOpen: surfaces.length > 0 ? current.isOpen : false,
              surfaces,
              activeSurfaceId: activeStillExists
                ? current.activeSurfaceId
                : (surfaces.at(-1)?.id ?? null),
            };
          }),
        })),
      show: (ref) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            current.isOpen ? current : { ...current, isOpen: true },
          ),
        })),
      close: (ref) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            current.isOpen ? { ...current, isOpen: false } : current,
          ),
        })),
      toggleVisibility: (ref) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => ({
            ...current,
            isOpen: !current.isOpen,
          })),
        })),
      toggle: (ref, kind) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const active = current.surfaces.find(
              (surface) => surface.id === current.activeSurfaceId,
            );
            if (current.isOpen && active?.kind === kind) {
              return { ...current, isOpen: false };
            }
            if (kind === "preview") {
              const existing = current.surfaces.find((surface) => surface.kind === "preview");
              return upsertSurface(current, existing ?? browserSurface(null));
            }
            return upsertSurface(current, singletonSurface(kind));
          }),
        })),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (!(threadKey in state.byThreadKey)) return state;
          const { [threadKey]: _removed, ...rest } = state.byThreadKey;
          return { byThreadKey: rest };
        }),
    }),
    {
      name: RIGHT_PANEL_STORAGE_KEY,
      version: RIGHT_PANEL_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byThreadKey: state.byThreadKey }),
      migrate: migratePersistedRightPanelState,
    },
  ),
);

export function selectThreadRightPanelState(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): ThreadRightPanelState {
  if (!ref) return EMPTY_THREAD_STATE;
  return byThreadKey[scopedThreadKey(ref)] ?? EMPTY_THREAD_STATE;
}

export function selectActiveRightPanel(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelKind | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  if (!state.isOpen) return null;
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId)?.kind ?? null;
}

export function selectActiveRightPanelSurface(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelSurface | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  if (!state.isOpen) return null;
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId) ?? null;
}
