import type { ContextMenuItem, PreviewSessionSnapshot } from "@t3tools/contracts";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Bot, ClipboardList, FileDiff, Files, Globe2, Plus, TerminalSquare, X } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { isElectron } from "~/env";
import {
  RIGHT_PANEL_MAX_PANES,
  RIGHT_PANEL_ROOT_PANE_ID,
  RIGHT_PANEL_WORKSPACE_DROP_ID,
  selectThreadRightPanelWorkspace,
  type RightPanelDropPosition,
  type RightPanelDropIntent,
  type RightPanelLayoutNode,
  type RightPanelPane,
  type RightPanelPaneId,
  type RightPanelSurface,
  type RightPanelWorkspaceState,
} from "~/rightPanelStore";
import {
  projectRightPanelDropPreview,
  projectedRightPanelSplitFits,
  resolveRightPanelDropIntent,
  rightPanelDropIntentId,
  type RightPanelDropGeometry,
} from "~/rightPanelDragLogic";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { ScrollArea } from "~/components/ui/scroll-area";
import { faviconUrlForOrigin } from "~/lib/favicon";
import { useTheme } from "~/hooks/useTheme";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

import {
  WORKBENCH_CONTENT_CROSSFADE_MS,
  crossfadeOffsetPx,
  getRovingTabIndex,
  getTabIndicatorMetrics,
  readMotionEasing,
  resolveSurfaceTransitionDirection,
  usePrefersReducedMotion,
  type SurfacePhase,
} from "./workbenchChoreography";
import { PreviewPanelShell, type PreviewPanelMode } from "./preview/PreviewPanelShell";
import { PierreEntryIcon } from "./chat/PierreEntryIcon";

const TAB_PANEL_DOM_ID = "right-panel-tabpanel";
const MIN_PROJECTED_PANE_WIDTH = 210;
const MIN_PROJECTED_PANE_HEIGHT = 150;

function tabDomId(index: number): string {
  return `right-panel-tab-${index}`;
}

function paneDomToken(paneId: string): string {
  return paneId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function paneTabDomId(paneId: string, index: number): string {
  return paneId === RIGHT_PANEL_ROOT_PANE_ID
    ? tabDomId(index)
    : `right-panel-${paneDomToken(paneId)}-tab-${index}`;
}

function panePanelDomId(paneId: string): string {
  return paneId === RIGHT_PANEL_ROOT_PANE_ID
    ? TAB_PANEL_DOM_ID
    : `right-panel-${paneDomToken(paneId)}-tabpanel`;
}

export interface RightPanelTabsProps {
  mode: PreviewPanelMode;
  maximized?: boolean;
  /** Presence phase for the inline shell; sheet/embedded hosts own their own. */
  phase?: SurfacePhase;
  layoutControls?: ReactNode;
  surfaces: readonly RightPanelSurface[];
  activeSurfaceId: string | null;
  workspace?: RightPanelWorkspaceState;
  pendingSurfaceIds: ReadonlySet<string>;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  terminalLabelsById: ReadonlyMap<string, string>;
  onActivate: (surface: RightPanelSurface) => void;
  onCloseSurface: (surface: RightPanelSurface) => void;
  onCloseOtherSurfaces: (surface: RightPanelSurface) => void;
  onCloseSurfacesToRight: (surface: RightPanelSurface) => void;
  onCloseAllSurfaces: () => void;
  onCopyFilePath: (relativePath: string) => void;
  onAddBrowser: () => void;
  onAddTerminal: () => void;
  onAddDiff: () => void;
  onAddFiles: () => void;
  onAddAgents: () => void;
  onMoveSurface?: (surface: RightPanelSurface, targetPaneId: RightPanelPaneId) => void;
  onSplitSurface?: (
    surface: RightPanelSurface,
    targetPaneId: RightPanelPaneId,
    position: Exclude<RightPanelDropPosition, "center">,
  ) => void;
  onFocusPane?: (paneId: RightPanelPaneId) => void;
  onSplitRatioChange?: (splitId: string, ratio: number) => void;
  browserAvailable: boolean;
  diffAvailable: boolean;
  filesAvailable: boolean;
  renderSurface?: (surface: RightPanelSurface) => ReactNode;
  children: ReactNode;
}

const SURFACE_DISABLED_REASONS = {
  browser: "Browser previews are only available in the V3 Code desktop app.",
  files: "Files are only available when a project is open.",
  diff: "Diff is only available for server threads in Git repositories.",
} as const;

type TabContextMenuAction =
  | "copy-path"
  | "close"
  | "close-others"
  | "close-to-right"
  | "close-all"
  | "split-top"
  | "split-right"
  | "split-bottom"
  | "split-left"
  | "move-other-pane";

function DisabledReasonTooltip(props: { reason: string; trigger: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.trigger} />
      <TooltipPopup side="top">{props.reason}</TooltipPopup>
    </Tooltip>
  );
}

function SurfaceMenuItem(props: {
  available: boolean;
  disabledReason?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const item = (
    <MenuItem
      className={!props.available ? "data-disabled:pointer-events-auto" : undefined}
      onClick={props.onClick}
      disabled={!props.available}
    >
      {props.children}
    </MenuItem>
  );
  if (props.available || !props.disabledReason) return item;
  return <DisabledReasonTooltip reason={props.disabledReason} trigger={item} />;
}

function RightPanelEmptyState(props: {
  onAddBrowser: () => void;
  onAddTerminal: () => void;
  onAddDiff: () => void;
  onAddFiles: () => void;
  onAddAgents: () => void;
  browserAvailable: boolean;
  diffAvailable: boolean;
  filesAvailable: boolean;
}) {
  const actions = [
    {
      label: "Browser",
      description: "Open a local app or URL.",
      icon: Globe2,
      available: props.browserAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.browser,
      onClick: props.onAddBrowser,
    },
    {
      label: "Terminal",
      description: "Start a shell in this workspace.",
      icon: TerminalSquare,
      available: true,
      disabledReason: null,
      onClick: props.onAddTerminal,
    },
    {
      label: "Files",
      description: "Browse and read workspace files.",
      icon: Files,
      available: props.filesAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.files,
      onClick: props.onAddFiles,
    },
    {
      label: "Diff",
      description: "Review changes in this thread.",
      icon: FileDiff,
      available: props.diffAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.diff,
      onClick: props.onAddDiff,
    },
    {
      label: "Agents",
      description: "Watch subagents and workflows run.",
      icon: Bot,
      available: true,
      disabledReason: null,
      onClick: props.onAddAgents,
    },
  ] as const;

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <div className="mb-5 text-center">
          <h3 className="text-sm font-medium text-foreground">Open a surface</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose what to show in the right panel.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {actions.map((action) => {
            const Icon = action.icon;
            const content = (
              <>
                <span className="mb-3 flex size-8 items-center justify-center rounded-lg border border-primary/15 bg-primary/8 text-primary transition-[background-color,border-color] duration-200 ease-out group-hover/surface:border-primary/25 group-hover/surface:bg-primary/10 motion-reduce:transition-none">
                  <Icon className="size-4.5" />
                </span>
                <span className="text-sm font-medium">{action.label}</span>
                <span className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {action.description}
                </span>
              </>
            );
            if (action.available) {
              return (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  className="group/surface flex min-h-28 w-full flex-col items-start rounded-lg border border-border/80 bg-card p-4 text-left transition-[background-color,border-color] duration-200 ease-out hover:border-primary/20 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none dark:border-transparent dark:inset-ring-1 dark:inset-ring-white/5"
                >
                  {content}
                </button>
              );
            }
            const disabledCard = (
              <button
                type="button"
                className="flex min-h-28 w-full cursor-not-allowed flex-col items-start rounded-lg border border-border/80 bg-card p-4 text-left opacity-40 dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5"
                aria-disabled="true"
              >
                {content}
              </button>
            );
            return (
              <DisabledReasonTooltip
                key={action.label}
                reason={action.disabledReason}
                trigger={disabledCard}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function surfaceTitle(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  terminalLabelsById: ReadonlyMap<string, string>,
): string {
  switch (surface.kind) {
    case "diff":
      return "Diff";
    case "files":
      return "Files";
    case "file":
      return surface.relativePath.slice(surface.relativePath.lastIndexOf("/") + 1);
    case "terminal":
      return (
        terminalLabelsById.get(surface.activeTerminalId) ??
        getTerminalLabel(surface.activeTerminalId)
      );
    case "plan":
      return "Plan";
    case "agents":
      return "Agents";
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      if (!snapshot || snapshot.navStatus._tag === "Idle") return "Browser";
      if (snapshot.navStatus.title.trim().length > 0) return snapshot.navStatus.title;
      try {
        return new URL(snapshot.navStatus.url).host || "Browser";
      } catch {
        return "Browser";
      }
    }
  }
}

function PreviewFavicon({ url }: { url: string | null }) {
  const faviconUrl = faviconUrlForOrigin(url, 32);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!faviconUrl || failedUrl === faviconUrl) return <Globe2 className="size-3.5 shrink-0" />;
  return (
    <img
      src={faviconUrl}
      alt=""
      aria-hidden
      draggable={false}
      className="size-3.5 shrink-0 rounded-sm"
      onError={() => setFailedUrl(faviconUrl)}
    />
  );
}

function SurfaceIcon({
  surface,
  sessions,
  theme,
}: {
  surface: RightPanelSurface;
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  theme: "light" | "dark";
}) {
  switch (surface.kind) {
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      const url = !snapshot || snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
      return <PreviewFavicon url={url} />;
    }
    case "diff":
      return <FileDiff className="size-3.5 shrink-0" />;
    case "files":
      return <Files className="size-3.5 shrink-0" />;
    case "file":
      return (
        <PierreEntryIcon
          pathValue={surface.relativePath}
          kind="file"
          theme={theme}
          className="size-3.5"
        />
      );
    case "terminal":
      return <TerminalSquare className="size-3.5 shrink-0" />;
    case "plan":
      return <ClipboardList className="size-3.5 shrink-0" />;
    case "agents":
      return <Bot className="size-3.5 shrink-0" />;
  }
}

function LegacyRightPanelTabs(props: RightPanelTabsProps) {
  const ownsDesktopTitleBar = isElectron && props.mode === "inline";
  const { resolvedTheme } = useTheme();
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);
  const panelContentRef = useRef<HTMLDivElement>(null);
  const previousSurfaceIndexRef = useRef<number | null>(null);
  const previousSelectedIndexRef = useRef<number | null>(null);
  const activationFrameRef = useRef<number | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  /**
   * Optimistic local selection. The clicked tab is marked selected in local
   * state on the same tick, so the halo/underline hand off within a frame
   * (Level 1 press feedback) instead of waiting for the store echo. The
   * authoritative `activeSurfaceId` prop travels store -> ChatView (a large
   * subtree) -> back down here, so relying on it alone leaves the highlight
   * lagging the click by the parent's render cost. `activeSurfaceId` still wins
   * on reconciliation: whenever it changes (the echo, or an external
   * activation/close) we adopt it, keeping local state from drifting.
   */
  const [selectedSurfaceId, setSelectedSurfaceId] = useState(props.activeSurfaceId);
  const lastActiveSurfaceIdRef = useRef(props.activeSurfaceId);
  if (lastActiveSurfaceIdRef.current !== props.activeSurfaceId) {
    lastActiveSurfaceIdRef.current = props.activeSurfaceId;
    setSelectedSurfaceId(props.activeSurfaceId);
  }

  const activeSurfaceIndex = props.surfaces.findIndex(
    (surface) => surface.id === props.activeSurfaceId,
  );
  const selectedSurfaceIndex = props.surfaces.findIndex(
    (surface) => surface.id === selectedSurfaceId,
  );

  useEffect(
    () => () => {
      if (activationFrameRef.current !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(activationFrameRef.current);
      }
    },
    [],
  );

  const { onActivate } = props;
  const handleActivate = useCallback(
    (surface: RightPanelSurface) => {
      // Flip the local highlight now so the halo/underline land this frame.
      setSelectedSurfaceId(surface.id);
      // Defer the store dispatch one frame. It re-renders the large ChatView
      // subtree and swaps the panel body; batching it into this commit would
      // make the highlight wait on that render. Next-frame keeps the press
      // feedback immediate and lets the content follow as a Level 2 handoff.
      if (typeof requestAnimationFrame === "function") {
        if (activationFrameRef.current !== null && typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(activationFrameRef.current);
        }
        activationFrameRef.current = requestAnimationFrame(() => {
          activationFrameRef.current = null;
          onActivate(surface);
        });
        return;
      }
      onActivate(surface);
    },
    [onActivate],
  );

  /**
   * Move the active-tab indicator and pick the direction of travel. Runs in a
   * layout effect and writes CSS custom properties straight onto the strip, so
   * the indicator never re-renders the tab list to move.
   */
  useLayoutEffect(() => {
    const strip = tabStripRef.current;
    if (!strip) return;
    const activeTab = strip.querySelector<HTMLElement>("[data-active-tab='true']");
    if (!activeTab) {
      strip.style.setProperty("--workbench-tab-indicator-opacity", "0");
      previousSelectedIndexRef.current = selectedSurfaceIndex;
      return;
    }
    const metrics = getTabIndicatorMetrics({
      rowLeft: strip.getBoundingClientRect().left,
      tabLeft: activeTab.getBoundingClientRect().left,
      tabWidth: activeTab.getBoundingClientRect().width,
    });
    if (metrics === null) {
      strip.style.setProperty("--workbench-tab-indicator-opacity", "0");
      previousSelectedIndexRef.current = selectedSurfaceIndex;
      return;
    }
    const direction = resolveSurfaceTransitionDirection(
      previousSelectedIndexRef.current ?? selectedSurfaceIndex,
      selectedSurfaceIndex,
    );
    previousSelectedIndexRef.current = selectedSurfaceIndex;
    strip.dataset["tabDirection"] = direction;
    strip.style.setProperty("--workbench-tab-indicator-x", `${metrics.left}px`);
    strip.style.setProperty("--workbench-tab-indicator-w", `${metrics.width}px`);
    strip.style.setProperty("--workbench-tab-indicator-opacity", "1");
  }, [selectedSurfaceIndex, props.surfaces]);

  /**
   * Directional 4px crossfade of the panel body. Driven through WAAPI rather
   * than a keyed wrapper on purpose: re-keying would remount the subtree and
   * tear down the live browser view or terminal it contains.
   */
  useLayoutEffect(() => {
    const previousIndex = previousSurfaceIndexRef.current;
    previousSurfaceIndexRef.current = activeSurfaceIndex;
    const element = panelContentRef.current;
    if (!element || previousIndex === null) return;
    if (prefersReducedMotion || typeof element.animate !== "function") return;

    const offset = crossfadeOffsetPx(
      resolveSurfaceTransitionDirection(previousIndex, activeSurfaceIndex),
    );
    if (offset === 0) return;

    element.animate(
      [
        { opacity: 0, transform: `translate3d(${offset}px, 0, 0)` },
        { opacity: 1, transform: "translate3d(0px, 0px, 0px)" },
      ],
      {
        duration: WORKBENCH_CONTENT_CROSSFADE_MS,
        easing: readMotionEasing("--ease-out-quart"),
        // `backwards`, never `both`: no transform is left on panel content.
        fill: "backwards",
      },
    );
  }, [activeSurfaceIndex, prefersReducedMotion]);

  /**
   * Roving-tabindex navigation for the tab strip. Movement only — activation
   * stays manual, because arrowing across these tabs would otherwise swap in a
   * live browser view or terminal on every keystroke.
   */
  const handleTabListKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const surfaces = props.surfaces;
      if (surfaces.length === 0) return;
      const strip = tabStripRef.current;
      if (!strip) return;
      const tabs = Array.from(strip.querySelectorAll<HTMLElement>("[role='tab']"));
      const focusedIndex = tabs.findIndex((tab) => tab === document.activeElement);
      if (focusedIndex < 0) return;

      const nextIndex = getRovingTabIndex({
        currentIndex: focusedIndex,
        key: event.key,
        count: tabs.length,
      });
      if (nextIndex !== null) {
        event.preventDefault();
        event.stopPropagation();
        tabs[nextIndex]?.focus();
        return;
      }

      const surface = surfaces[focusedIndex];
      if (!surface) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleActivate(surface);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        props.onCloseSurface(surface);
      }
    },
    [props, handleActivate],
  );

  const handleTabContextMenu = useCallback(
    async (event: ReactMouseEvent, surface: RightPanelSurface) => {
      event.preventDefault();
      event.stopPropagation();

      const api = readLocalApi();
      if (!api) return;

      const surfaceIndex = props.surfaces.findIndex((entry) => entry.id === surface.id);
      if (surfaceIndex < 0) return;

      const items: ContextMenuItem<TabContextMenuAction>[] = [];
      if (surface.kind === "file") {
        items.push({ id: "copy-path", label: "Copy path" });
      }
      items.push(
        { id: "close", label: "Close" },
        {
          id: "close-others",
          label: "Close others",
          disabled: props.surfaces.length <= 1,
        },
        {
          id: "close-to-right",
          label: "Close to the right",
          disabled: surfaceIndex >= props.surfaces.length - 1,
        },
        {
          id: "close-all",
          label: "Close all",
          disabled: props.surfaces.length === 0,
        },
      );

      const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
      switch (action) {
        case "copy-path":
          if (surface.kind === "file") props.onCopyFilePath(surface.relativePath);
          break;
        case "close":
          props.onCloseSurface(surface);
          break;
        case "close-others":
          props.onCloseOtherSurfaces(surface);
          break;
        case "close-to-right":
          props.onCloseSurfacesToRight(surface);
          break;
        case "close-all":
          props.onCloseAllSurfaces();
          break;
        case null:
          break;
      }
    },
    [props],
  );
  const handleTabMouseDown = useCallback((event: ReactMouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
  }, []);
  const handleTabAuxClick = useCallback(
    (event: ReactMouseEvent, surface: RightPanelSurface) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      props.onCloseSurface(surface);
    },
    [props],
  );

  useEffect(() => {
    const activeTab = tabListRef.current?.querySelector<HTMLElement>("[data-active-tab='true']");
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedSurfaceId]);

  return (
    <PreviewPanelShell
      mode={props.mode}
      {...(props.maximized !== undefined ? { maximized: props.maximized } : {})}
      {...(props.phase !== undefined ? { phase: props.phase } : {})}
    >
      <div
        className={cn(
          "workspace-topbar gap-1 border-b border-primary/10 bg-background pl-2",
          !ownsDesktopTitleBar && "[--workspace-topbar-height:--spacing(11)]",
          props.mode === "inline" ? "pr-28" : "pr-3",
          ownsDesktopTitleBar && "wco:pr-[calc(var(--workspace-native-controls-inset)+6rem)]",
          props.mode === "inline" && props.maximized && COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        )}
        data-right-panel-tabbar
      >
        <ScrollArea
          ref={tabListRef}
          hideScrollbars
          scrollFade
          className={cn("min-w-0 flex-1 rounded-none", ownsDesktopTitleBar && "drag-region")}
          data-right-panel-tab-list
        >
          <div className="flex h-full w-max min-w-full items-center gap-1">
            <div
              ref={tabStripRef}
              role="tablist"
              aria-label="Right panel surfaces"
              aria-orientation="horizontal"
              data-tab-direction="none"
              onKeyDown={handleTabListKeyDown}
              className="workbench-tab-strip flex h-full items-center gap-1"
              style={{ "--workbench-tab-indicator-opacity": "0" } as CSSProperties}
            >
              {props.surfaces.length > 0 ? (
                <span aria-hidden className="workbench-tab-indicator" />
              ) : null}
              {props.surfaces.map((surface, index) => {
                const active = surface.id === selectedSurfaceId;
                const pending = props.pendingSurfaceIds.has(surface.id);
                const title = surfaceTitle(
                  surface,
                  props.previewSessions,
                  props.terminalLabelsById,
                );
                return (
                  <div
                    key={surface.id}
                    id={tabDomId(index)}
                    role="tab"
                    aria-selected={active}
                    aria-controls={TAB_PANEL_DOM_ID}
                    // Roving tabindex: the strip is a single tab stop and the
                    // arrow keys move within it.
                    tabIndex={active ? 0 : -1}
                    data-active-tab={active}
                    onClick={() => handleActivate(surface)}
                    onMouseDown={handleTabMouseDown}
                    onAuxClick={(event) => handleTabAuxClick(event, surface)}
                    onContextMenu={(event) => void handleTabContextMenu(event, surface)}
                    className={cn(
                      // `[-webkit-app-region:no-drag]` is load-bearing, not cosmetic.
                      // The strip carries `.drag-region` in Electron, and Chromium
                      // routes pointer events inside a drag region to the window
                      // manager rather than the DOM. `index.css` exempts only
                      // `button, input, textarea, select, a` — this tab is a `div`,
                      // so without the explicit exemption it becomes titlebar chrome
                      // and `onClick` below never fires. The ✕ kept working precisely
                      // because it is still a `<button>`.
                      "workbench-terminal-tab group relative flex h-7 min-w-25 max-w-44 shrink-0 cursor-default items-center gap-1.5 overflow-hidden rounded-md px-2 text-sm outline-none [-webkit-app-region:no-drag] focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "bg-primary/10 text-foreground inset-ring-1 inset-ring-primary/15"
                        : "text-muted-foreground hover:bg-primary/8 hover:text-foreground",
                    )}
                  >
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            <SurfaceIcon
                              surface={surface}
                              sessions={props.previewSessions}
                              theme={resolvedTheme}
                            />
                            <span className="truncate">{title}</span>
                          </span>
                        }
                      />
                      <TooltipPopup>{title}</TooltipPopup>
                    </Tooltip>
                    <button
                      type="button"
                      // Out of the document tab order so the strip stays a single
                      // tab stop; Delete/Backspace on the focused tab closes it.
                      tabIndex={-1}
                      className={cn(
                        "relative flex size-4 shrink-0 items-center justify-center rounded hover:bg-muted focus:opacity-100",
                        pending ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                      )}
                      aria-label={`Close ${title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onCloseSurface(surface);
                      }}
                    >
                      {pending ? (
                        <>
                          <span
                            className="size-2 animate-status-pulse rounded-full bg-primary group-hover:hidden motion-reduce:animate-none"
                            aria-hidden
                          />
                          <X className="hidden size-3 group-hover:block" />
                        </>
                      ) : (
                        <X className="size-3" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
            {props.surfaces.length > 0 ? (
              <Menu>
                <MenuTrigger
                  className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color] duration-200 ease-out hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                  aria-label="Add panel surface"
                >
                  <Plus className="size-4" />
                </MenuTrigger>
                <MenuPopup align="start" side="bottom" sideOffset={6} className="min-w-44">
                  <SurfaceMenuItem
                    available={props.browserAvailable}
                    disabledReason={SURFACE_DISABLED_REASONS.browser}
                    onClick={props.onAddBrowser}
                  >
                    <Globe2 />
                    Browser
                  </SurfaceMenuItem>
                  <SurfaceMenuItem available onClick={props.onAddTerminal}>
                    <TerminalSquare />
                    Terminal
                  </SurfaceMenuItem>
                  <SurfaceMenuItem
                    available={props.filesAvailable}
                    disabledReason={SURFACE_DISABLED_REASONS.files}
                    onClick={props.onAddFiles}
                  >
                    <Files />
                    Files
                  </SurfaceMenuItem>
                  <SurfaceMenuItem
                    available={props.diffAvailable}
                    disabledReason={SURFACE_DISABLED_REASONS.diff}
                    onClick={props.onAddDiff}
                  >
                    <FileDiff />
                    Diff
                  </SurfaceMenuItem>
                  <SurfaceMenuItem available onClick={props.onAddAgents}>
                    <Bot />
                    Agents
                  </SurfaceMenuItem>
                </MenuPopup>
              </Menu>
            ) : null}
          </div>
        </ScrollArea>
        {props.layoutControls}
      </div>
      <div
        ref={panelContentRef}
        id={TAB_PANEL_DOM_ID}
        role="tabpanel"
        {...(selectedSurfaceIndex >= 0
          ? { "aria-labelledby": tabDomId(selectedSurfaceIndex) }
          : {})}
        className="workbench-panel-content flex min-h-0 flex-1 flex-col"
      >
        {props.activeSurfaceId === null ? (
          <RightPanelEmptyState
            onAddBrowser={props.onAddBrowser}
            onAddTerminal={props.onAddTerminal}
            onAddDiff={props.onAddDiff}
            onAddFiles={props.onAddFiles}
            onAddAgents={props.onAddAgents}
            browserAvailable={props.browserAvailable}
            diffAvailable={props.diffAvailable}
            filesAvailable={props.filesAvailable}
          />
        ) : (
          props.children
        )}
      </div>
    </PreviewPanelShell>
  );
}

type PaneEdges = {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
};

type WorkspaceDropData = {
  scope: "pane" | "workspace" | "dock" | "pane-container";
  paneId: RightPanelPaneId;
  position: RightPanelDropPosition;
};

type WorkspaceDragData = {
  surface: RightPanelSurface;
  sourcePaneId: RightPanelPaneId;
};

const ALL_PANE_EDGES: PaneEdges = {
  top: true,
  right: true,
  bottom: true,
  left: true,
};

function paneSurfaces(
  pane: RightPanelPane,
  surfacesById: ReadonlyMap<string, RightPanelSurface>,
): RightPanelSurface[] {
  return pane.surfaceIds.flatMap((surfaceId) => {
    const surface = surfacesById.get(surfaceId);
    return surface ? [surface] : [];
  });
}

function WorkspaceDropZone(props: {
  paneId: RightPanelPaneId;
  position: RightPanelDropPosition;
  disabled?: boolean;
}) {
  const { setNodeRef } = useDroppable({
    id: `right-panel-drop:${props.paneId}:${props.position}`,
    data: {
      scope: "pane",
      paneId: props.paneId,
      position: props.position,
    } satisfies WorkspaceDropData,
    disabled: props.disabled ?? false,
  });

  return (
    <div
      ref={setNodeRef}
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-1/2 top-1/2 size-px",
        props.disabled && "hidden",
      )}
    />
  );
}

function WorkspaceEdgeDropZone(props: {
  position: Exclude<RightPanelDropPosition, "center">;
  disabled: boolean;
}) {
  const { setNodeRef } = useDroppable({
    id: `right-panel-workspace-drop:${props.position}`,
    data: {
      scope: "workspace",
      paneId: RIGHT_PANEL_WORKSPACE_DROP_ID,
      position: props.position,
    } satisfies WorkspaceDropData,
    disabled: props.disabled,
  });

  return (
    <div
      ref={setNodeRef}
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-1/2 top-1/2 size-px",
        props.disabled && "hidden",
      )}
    />
  );
}

function DraggableWorkspaceTab(props: {
  surface: RightPanelSurface;
  paneId: RightPanelPaneId;
  index: number;
  active: boolean;
  pending: boolean;
  title: string;
  panelId: string;
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  theme: "light" | "dark";
  onActivate: () => void;
  onClose: () => void;
  onContextMenu: (event: ReactMouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `right-panel-drag:${props.surface.id}`,
    data: {
      surface: props.surface,
      sourcePaneId: props.paneId,
    } satisfies WorkspaceDragData,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      id={paneTabDomId(props.paneId, props.index)}
      role="tab"
      aria-selected={props.active}
      aria-controls={props.panelId}
      tabIndex={props.active ? 0 : -1}
      data-active-tab={props.active}
      data-dragging={isDragging ? "true" : "false"}
      onClick={props.onActivate}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      }}
      onContextMenu={props.onContextMenu}
      className={cn(
        "workbench-terminal-tab group relative flex h-7 min-w-24 max-w-44 shrink-0 cursor-grab touch-none items-center gap-1.5 overflow-hidden rounded-md px-2 text-sm outline-none [-webkit-app-region:no-drag] focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
        props.active
          ? "bg-primary/10 text-foreground inset-ring-1 inset-ring-primary/20"
          : "text-muted-foreground hover:bg-primary/8 hover:text-foreground",
        isDragging && "opacity-25",
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <SurfaceIcon surface={props.surface} sessions={props.sessions} theme={props.theme} />
              <span className="truncate">{props.title}</span>
            </span>
          }
        />
        <TooltipPopup>{props.title}</TooltipPopup>
      </Tooltip>
      <button
        type="button"
        tabIndex={-1}
        className={cn(
          "relative flex size-4 shrink-0 items-center justify-center rounded hover:bg-muted focus:opacity-100",
          props.pending ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
        aria-label={`Close ${props.title}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          props.onClose();
        }}
      >
        {props.pending ? (
          <>
            <span
              className="size-2 animate-status-pulse rounded-full bg-primary group-hover:hidden motion-reduce:animate-none"
              aria-hidden
            />
            <X className="hidden size-3 group-hover:block" />
          </>
        ) : (
          <X className="size-3" />
        )}
      </button>
    </div>
  );
}

function WorkspacePane(props: {
  pane: RightPanelPane;
  edges: PaneEdges;
  focused: boolean;
  paneCount: number;
  draggedSurface: RightPanelSurface | null;
  dragSplitEligibility: { horizontal: boolean; vertical: boolean };
  surfacesById: ReadonlyMap<string, RightPanelSurface>;
  workspaceProps: RightPanelTabsProps;
}) {
  const {
    pane,
    edges,
    focused,
    paneCount,
    draggedSurface,
    dragSplitEligibility,
    surfacesById,
    workspaceProps,
  } = props;
  const { resolvedTheme } = useTheme();
  const paneRef = useRef<HTMLDivElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const { setNodeRef: setPaneTargetRef } = useDroppable({
    id: `right-panel-pane-container:${pane.id}`,
    data: {
      scope: "pane-container",
      paneId: pane.id,
      position: "center",
    } satisfies WorkspaceDropData,
    disabled: draggedSurface === null,
  });
  const { isOver: isDockTarget, setNodeRef: setDockTargetRef } = useDroppable({
    id: `right-panel-dock:${pane.id}`,
    data: {
      scope: "dock",
      paneId: pane.id,
      position: "center",
    } satisfies WorkspaceDropData,
    disabled: draggedSurface === null,
  });
  const setPaneNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
      paneRef.current = node;
      setPaneTargetRef(node);
    },
    [setPaneTargetRef],
  );
  const setTabListNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
      tabListRef.current = node;
      setDockTargetRef(node);
    },
    [setDockTargetRef],
  );
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });
  const surfaces = paneSurfaces(pane, surfacesById);
  const selectedIndex = surfaces.findIndex((surface) => surface.id === pane.activeSurfaceId);
  const activeSurface = selectedIndex >= 0 ? surfaces[selectedIndex] : null;
  const canAddPane = paneCount < RIGHT_PANEL_MAX_PANES;
  const canSplitHorizontally = draggedSurface
    ? dragSplitEligibility.horizontal
    : canAddPane && paneSize.width >= MIN_PROJECTED_PANE_WIDTH * 2;
  const canSplitVertically = draggedSurface
    ? dragSplitEligibility.vertical
    : canAddPane && paneSize.height >= MIN_PROJECTED_PANE_HEIGHT * 2;
  const ownsDesktopTitleBar = isElectron && workspaceProps.mode === "inline" && edges.top;

  useEffect(() => {
    const element = paneRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setPaneSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const activeTab = tabListRef.current?.querySelector<HTMLElement>("[data-active-tab='true']");
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pane.activeSurfaceId]);

  const activate = (surface: RightPanelSurface) => {
    workspaceProps.onFocusPane?.(pane.id);
    workspaceProps.onActivate(surface);
  };

  const handleTabListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (surfaces.length === 0) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[role='tab']"));
    const focusedIndex = tabs.findIndex((tab) => tab === document.activeElement);
    if (focusedIndex < 0) return;
    const nextIndex = getRovingTabIndex({
      currentIndex: focusedIndex,
      key: event.key,
      count: tabs.length,
    });
    if (nextIndex !== null) {
      event.preventDefault();
      tabs[nextIndex]?.focus();
      return;
    }
    const surface = surfaces[focusedIndex];
    if (!surface) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(surface);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      workspaceProps.onCloseSurface(surface);
    }
  };

  const handleContextMenu = async (event: ReactMouseEvent, surface: RightPanelSurface) => {
    event.preventDefault();
    event.stopPropagation();
    const api = readLocalApi();
    if (!api) return;
    const surfaceIndex = workspaceProps.surfaces.findIndex(
      (candidate) => candidate.id === surface.id,
    );
    const items: ContextMenuItem<TabContextMenuAction>[] = [];
    if (surface.kind === "file") {
      items.push({ id: "copy-path", label: "Copy path" });
    }
    items.push(
      { id: "close", label: "Close" },
      {
        id: "close-others",
        label: "Close others",
        disabled: workspaceProps.surfaces.length <= 1,
      },
      {
        id: "close-to-right",
        label: "Close to the right",
        disabled: surfaceIndex < 0 || surfaceIndex >= workspaceProps.surfaces.length - 1,
      },
      { id: "close-all", label: "Close all" },
      {
        id: "split-left",
        label: "Split pane left",
        disabled: !canSplitHorizontally || surfaces.length <= 1,
      },
      {
        id: "split-right",
        label: "Split pane right",
        disabled: !canSplitHorizontally || surfaces.length <= 1,
      },
      {
        id: "split-top",
        label: "Split pane above",
        disabled: !canSplitVertically || surfaces.length <= 1,
      },
      {
        id: "split-bottom",
        label: "Split pane below",
        disabled: !canSplitVertically || surfaces.length <= 1,
      },
    );
    const otherPane = Object.values(workspaceProps.workspace?.panes ?? {}).find(
      (candidate) => candidate.id !== pane.id,
    );
    if (otherPane) {
      items.push({
        id: "move-other-pane",
        label: "Move to other pane",
      });
    }

    const action = await api.contextMenu.show(items, {
      x: event.clientX,
      y: event.clientY,
    });
    if (action === "copy-path" && surface.kind === "file") {
      workspaceProps.onCopyFilePath(surface.relativePath);
    } else if (action === "close") {
      workspaceProps.onCloseSurface(surface);
    } else if (action === "close-others") {
      workspaceProps.onCloseOtherSurfaces(surface);
    } else if (action === "close-to-right") {
      workspaceProps.onCloseSurfacesToRight(surface);
    } else if (action === "close-all") {
      workspaceProps.onCloseAllSurfaces();
    } else if (
      action === "split-left" ||
      action === "split-right" ||
      action === "split-top" ||
      action === "split-bottom"
    ) {
      workspaceProps.onSplitSurface?.(
        surface,
        pane.id,
        action.replace("split-", "") as Exclude<RightPanelDropPosition, "center">,
      );
    } else if (action === "move-other-pane" && otherPane) {
      workspaceProps.onMoveSurface?.(surface, otherPane.id);
    }
  };

  const panelId = panePanelDomId(pane.id);

  return (
    <section
      ref={setPaneNodeRef}
      data-right-panel-pane={pane.id}
      data-focused={focused ? "true" : "false"}
      className="right-panel-pane relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
      onPointerDown={() => workspaceProps.onFocusPane?.(pane.id)}
    >
      <div
        className={cn(
          "right-panel-tab-dock-target workspace-topbar min-h-9 gap-1 border-b border-primary/10 bg-background pl-2",
          isDockTarget && "right-panel-tab-dock-target-active",
          edges.right ? "pr-3" : "pr-2",
          ownsDesktopTitleBar &&
            edges.right &&
            "wco:pr-[calc(var(--workspace-native-controls-inset)+6rem)]",
          workspaceProps.mode === "inline" &&
            workspaceProps.maximized &&
            edges.left &&
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        )}
        data-right-panel-tabbar
      >
        <ScrollArea
          ref={setTabListNodeRef}
          hideScrollbars
          scrollFade
          className={cn("min-w-0 flex-1 rounded-none", ownsDesktopTitleBar && "drag-region")}
          data-right-panel-tab-list
        >
          <div className="flex h-full w-max min-w-full items-center gap-1">
            <div
              role="tablist"
              aria-label={`Panel ${pane.id} tabs`}
              aria-orientation="horizontal"
              onKeyDown={handleTabListKeyDown}
              className="workbench-tab-strip flex h-full items-center gap-1"
            >
              {surfaces.map((surface, index) => {
                const title = surfaceTitle(
                  surface,
                  workspaceProps.previewSessions,
                  workspaceProps.terminalLabelsById,
                );
                return (
                  <DraggableWorkspaceTab
                    key={surface.id}
                    surface={surface}
                    paneId={pane.id}
                    index={index}
                    active={surface.id === pane.activeSurfaceId}
                    pending={workspaceProps.pendingSurfaceIds.has(surface.id)}
                    title={title}
                    panelId={panelId}
                    sessions={workspaceProps.previewSessions}
                    theme={resolvedTheme}
                    onActivate={() => activate(surface)}
                    onClose={() => workspaceProps.onCloseSurface(surface)}
                    onContextMenu={(event) => void handleContextMenu(event, surface)}
                  />
                );
              })}
            </div>
            <Menu>
              <MenuTrigger
                className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color] duration-200 ease-out hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                aria-label="Add panel surface"
              >
                <Plus className="size-4" />
              </MenuTrigger>
              <MenuPopup align="start" side="bottom" sideOffset={6} className="min-w-44">
                <SurfaceMenuItem
                  available={workspaceProps.browserAvailable}
                  disabledReason={SURFACE_DISABLED_REASONS.browser}
                  onClick={workspaceProps.onAddBrowser}
                >
                  <Globe2 />
                  Browser
                </SurfaceMenuItem>
                <SurfaceMenuItem available onClick={workspaceProps.onAddTerminal}>
                  <TerminalSquare />
                  Terminal
                </SurfaceMenuItem>
                <SurfaceMenuItem
                  available={workspaceProps.filesAvailable}
                  disabledReason={SURFACE_DISABLED_REASONS.files}
                  onClick={workspaceProps.onAddFiles}
                >
                  <Files />
                  Files
                </SurfaceMenuItem>
                <SurfaceMenuItem
                  available={workspaceProps.diffAvailable}
                  disabledReason={SURFACE_DISABLED_REASONS.diff}
                  onClick={workspaceProps.onAddDiff}
                >
                  <FileDiff />
                  Diff
                </SurfaceMenuItem>
                <SurfaceMenuItem available onClick={workspaceProps.onAddAgents}>
                  <Bot />
                  Agents
                </SurfaceMenuItem>
              </MenuPopup>
            </Menu>
          </div>
        </ScrollArea>
        {edges.top && edges.right ? workspaceProps.layoutControls : null}
      </div>

      <div
        id={panelId}
        role="tabpanel"
        {...(selectedIndex >= 0 ? { "aria-labelledby": paneTabDomId(pane.id, selectedIndex) } : {})}
        className="workbench-panel-content flex min-h-0 flex-1 flex-col"
      >
        {activeSurface ? (
          workspaceProps.renderSurface?.(activeSurface)
        ) : (
          <RightPanelEmptyState
            onAddBrowser={workspaceProps.onAddBrowser}
            onAddTerminal={workspaceProps.onAddTerminal}
            onAddDiff={workspaceProps.onAddDiff}
            onAddFiles={workspaceProps.onAddFiles}
            onAddAgents={workspaceProps.onAddAgents}
            browserAvailable={workspaceProps.browserAvailable}
            diffAvailable={workspaceProps.diffAvailable}
            filesAvailable={workspaceProps.filesAvailable}
          />
        )}
      </div>

      {draggedSurface ? (
        <div className="pointer-events-none absolute inset-0 z-20">
          <WorkspaceDropZone paneId={pane.id} position="top" disabled={!canSplitVertically} />
          <WorkspaceDropZone paneId={pane.id} position="right" disabled={!canSplitHorizontally} />
          <WorkspaceDropZone paneId={pane.id} position="bottom" disabled={!canSplitVertically} />
          <WorkspaceDropZone paneId={pane.id} position="left" disabled={!canSplitHorizontally} />
          <WorkspaceDropZone paneId={pane.id} position="center" />
        </div>
      ) : null}
    </section>
  );
}

function WorkspaceSplitNode(props: {
  node: Extract<RightPanelLayoutNode, { type: "split" }>;
  edges: PaneEdges;
  renderNode: (node: RightPanelLayoutNode, edges: PaneEdges) => ReactNode;
  onRatioChange?: (splitId: string, ratio: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [liveRatio, setLiveRatio] = useState<number | null>(null);
  const ratio = liveRatio ?? props.node.ratio;
  const horizontal = props.node.axis === "horizontal";

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const update = (clientX: number, clientY: number) => {
      const raw = horizontal
        ? (clientX - rect.left) / rect.width
        : (clientY - rect.top) / rect.height;
      setLiveRatio(Math.max(0.15, Math.min(0.85, raw)));
    };
    const handleMove = (pointerEvent: PointerEvent) =>
      update(pointerEvent.clientX, pointerEvent.clientY);
    const handleUp = (pointerEvent: PointerEvent) => {
      const raw = horizontal
        ? (pointerEvent.clientX - rect.left) / rect.width
        : (pointerEvent.clientY - rect.top) / rect.height;
      const nextRatio = Math.max(0.15, Math.min(0.85, raw));
      setLiveRatio(null);
      props.onRatioChange?.(props.node.id, nextRatio);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = horizontal ? "col-resize" : "row-resize";
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };

  const firstEdges: PaneEdges = horizontal
    ? { ...props.edges, right: false }
    : { ...props.edges, bottom: false };
  const secondEdges: PaneEdges = horizontal
    ? { ...props.edges, left: false }
    : { ...props.edges, top: false };

  return (
    <div
      ref={containerRef}
      data-right-panel-split={props.node.axis}
      data-resizing={liveRatio !== null ? "true" : "false"}
      className={cn(
        "right-panel-split flex min-h-0 min-w-0 flex-1",
        horizontal ? "flex-row" : "flex-col",
      )}
    >
      <div
        className="right-panel-split-child flex min-h-0 min-w-0"
        style={{ flexBasis: `${ratio * 100}%` }}
      >
        {props.renderNode(props.node.first, firstEdges)}
      </div>
      <div
        role="separator"
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-valuemin={15}
        aria-valuemax={85}
        aria-valuenow={Math.round(ratio * 100)}
        tabIndex={0}
        className={cn(
          "right-panel-splitter relative z-10 shrink-0 bg-border/70 outline-none transition-colors hover:bg-primary/60 focus-visible:bg-primary",
          horizontal ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
        )}
        onPointerDown={beginResize}
        onDoubleClick={() => props.onRatioChange?.(props.node.id, 0.5)}
        onKeyDown={(event) => {
          const decrement = event.key === (horizontal ? "ArrowLeft" : "ArrowUp");
          const increment = event.key === (horizontal ? "ArrowRight" : "ArrowDown");
          if (!decrement && !increment && event.key !== "Home") return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0.5
              : Math.max(0.15, Math.min(0.85, ratio + (increment ? 0.05 : -0.05)));
          props.onRatioChange?.(props.node.id, next);
        }}
      />
      <div
        className="right-panel-split-child flex min-h-0 min-w-0 flex-1"
        style={{ flexBasis: `${(1 - ratio) * 100}%` }}
      >
        {props.renderNode(props.node.second, secondEdges)}
      </div>
    </div>
  );
}

function RightPanelWorkspace(
  props: RightPanelTabsProps & {
    workspace: RightPanelWorkspaceState;
    renderSurface: (surface: RightPanelSurface) => ReactNode;
  },
) {
  const [draggedSurface, setDraggedSurface] = useState<RightPanelSurface | null>(null);
  const [activeDropIntent, setActiveDropIntent] = useState<RightPanelDropIntent | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const previousDropIntentRef = useRef<RightPanelDropIntent | null>(null);
  const resolvedDropIntentRef = useRef<RightPanelDropIntent | null>(null);
  const [workspaceSize, setWorkspaceSize] = useState({ width: 0, height: 0 });
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const surfacesById = useMemo(
    () => new Map(props.surfaces.map((surface) => [surface.id, surface])),
    [props.surfaces],
  );
  const paneCount = Object.keys(props.workspace.panes).length;
  const projectionThreadState = useMemo(
    () => ({
      isOpen: true,
      activeSurfaceId: props.activeSurfaceId,
      surfaces: [...props.surfaces],
      layout: props.workspace.layout,
      panes: props.workspace.panes,
      focusedPaneId: props.workspace.focusedPaneId,
    }),
    [props.activeSurfaceId, props.surfaces, props.workspace],
  );
  const projectedSplitEligibility = useMemo(() => {
    const byPane = new Map<RightPanelPaneId, { horizontal: boolean; vertical: boolean }>();
    const unavailable = { horizontal: false, vertical: false };
    if (!draggedSurface || workspaceSize.width <= 0 || workspaceSize.height <= 0) {
      return { byPane, workspace: unavailable };
    }
    const fits = (intent: Extract<RightPanelDropIntent, { type: "split" }>): boolean =>
      projectedRightPanelSplitFits({
        threadState: projectionThreadState,
        surfaceId: draggedSurface.id,
        intent,
        workspaceWidth: workspaceSize.width,
        workspaceHeight: workspaceSize.height,
        minPaneWidth: MIN_PROJECTED_PANE_WIDTH,
        minPaneHeight: MIN_PROJECTED_PANE_HEIGHT,
      });

    for (const paneId of Object.keys(props.workspace.panes)) {
      byPane.set(paneId, {
        horizontal: fits({
          type: "split",
          target: "pane",
          targetPaneId: paneId,
          position: "right",
        }),
        vertical: fits({
          type: "split",
          target: "pane",
          targetPaneId: paneId,
          position: "bottom",
        }),
      });
    }
    return {
      byPane,
      workspace: {
        horizontal: fits({ type: "split", target: "workspace", position: "right" }),
        vertical: fits({ type: "split", target: "workspace", position: "bottom" }),
      },
    };
  }, [draggedSurface, projectionThreadState, props.workspace.panes, workspaceSize]);

  const collisionDetection = useCallback<CollisionDetection>((args) => {
    if (!args.pointerCoordinates) {
      resolvedDropIntentRef.current = null;
      previousDropIntentRef.current = null;
      return [];
    }

    const workspaceRect: RightPanelDropGeometry["workspace"] | null =
      workspaceRef.current?.getBoundingClientRect() ?? null;
    const panes: RightPanelDropGeometry["panes"][number][] = [];
    const docks: RightPanelDropGeometry["docks"][number][] = [];
    const enabledIntentIds = new Set<string>();

    for (const container of args.droppableContainers) {
      const data = container.data.current as WorkspaceDropData | undefined;
      const rect = args.droppableRects.get(container.id);
      if (!data || !rect) continue;
      if (data.scope === "dock" || data.scope === "pane" || data.scope === "workspace") {
        enabledIntentIds.add(String(container.id));
      }
      if (data.scope === "pane-container") {
        panes.push({ paneId: data.paneId, rect });
      } else if (data.scope === "dock") {
        docks.push({ paneId: data.paneId, rect });
      }
    }

    if (!workspaceRect) {
      resolvedDropIntentRef.current = null;
      return [];
    }
    const geometry: RightPanelDropGeometry = {
      workspace: workspaceRect,
      panes,
      docks,
      enabledIntentIds,
    };
    const intent = resolveRightPanelDropIntent({
      point: args.pointerCoordinates,
      geometry,
      previousIntent: previousDropIntentRef.current,
    });
    resolvedDropIntentRef.current = intent;
    previousDropIntentRef.current = intent;
    if (!intent) return [];

    const targetId = rightPanelDropIntentId(intent);
    const target = args.droppableContainers.find((container) => String(container.id) === targetId);
    return target
      ? [
          {
            id: target.id,
            data: { droppableContainer: target, value: 1 },
          },
        ]
      : [];
  }, []);

  useEffect(() => {
    const element = workspaceRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setWorkspaceSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const renderNode = (node: RightPanelLayoutNode, edges: PaneEdges): ReactNode => {
    if (node.type === "split") {
      return (
        <WorkspaceSplitNode
          key={node.id}
          node={node}
          edges={edges}
          renderNode={renderNode}
          {...(props.onSplitRatioChange ? { onRatioChange: props.onSplitRatioChange } : {})}
        />
      );
    }
    const pane = props.workspace.panes[node.paneId];
    if (!pane) return null;
    return (
      <WorkspacePane
        key={pane.id}
        pane={pane}
        edges={edges}
        focused={pane.id === props.workspace.focusedPaneId}
        paneCount={paneCount}
        draggedSurface={draggedSurface}
        dragSplitEligibility={
          projectedSplitEligibility.byPane.get(pane.id) ?? {
            horizontal: false,
            vertical: false,
          }
        }
        surfacesById={surfacesById}
        workspaceProps={props}
      />
    );
  };

  const previewRect = useMemo(() => {
    if (!draggedSurface || !activeDropIntent) return null;
    return projectRightPanelDropPreview({
      threadState: projectionThreadState,
      surfaceId: draggedSurface.id,
      intent: activeDropIntent,
    });
  }, [activeDropIntent, draggedSurface, projectionThreadState]);

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as WorkspaceDragData | undefined;
    if (!data?.surface) return;
    previousDropIntentRef.current = null;
    resolvedDropIntentRef.current = null;
    setActiveDropIntent(null);
    setDraggedSurface(data.surface);
  };

  const handleDragOver = (_event: DragOverEvent) => {
    setActiveDropIntent(resolvedDropIntentRef.current);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const dragData = event.active.data.current as WorkspaceDragData | undefined;
    const intent = resolvedDropIntentRef.current;
    previousDropIntentRef.current = null;
    resolvedDropIntentRef.current = null;
    setActiveDropIntent(null);
    setDraggedSurface(null);
    if (!dragData || !intent) return;
    const surface = dragData.surface;
    if (intent.type === "move") {
      props.onMoveSurface?.(surface, intent.targetPaneId);
      setAnnouncement(
        `Moved ${surfaceTitle(surface, props.previewSessions, props.terminalLabelsById)} to panel.`,
      );
      return;
    }
    props.onSplitSurface?.(
      surface,
      intent.target === "workspace" ? RIGHT_PANEL_WORKSPACE_DROP_ID : intent.targetPaneId,
      intent.position,
    );
    setAnnouncement(
      `Split ${surfaceTitle(surface, props.previewSessions, props.terminalLabelsById)} ${intent.position}.`,
    );
  };

  const handleDragCancel = () => {
    previousDropIntentRef.current = null;
    resolvedDropIntentRef.current = null;
    setActiveDropIntent(null);
    setDraggedSurface(null);
  };

  const dragOverlay = (
    <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }}>
      {draggedSurface ? (
        <div className="right-panel-drag-overlay flex h-8 max-w-56 items-center gap-2 rounded-md border border-primary/50 bg-popover/95 px-3 text-sm text-foreground shadow-xl shadow-primary/15 backdrop-blur">
          <SurfaceIcon surface={draggedSurface} sessions={props.previewSessions} theme="dark" />
          <span className="truncate">
            {surfaceTitle(draggedSurface, props.previewSessions, props.terminalLabelsById)}
          </span>
        </div>
      ) : null}
    </DragOverlay>
  );

  return (
    <PreviewPanelShell
      mode={props.mode}
      {...(props.maximized !== undefined ? { maximized: props.maximized } : {})}
      {...(props.phase !== undefined ? { phase: props.phase } : {})}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          ref={workspaceRef}
          data-right-panel-workspace
          className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
        >
          {renderNode(props.workspace.layout, ALL_PANE_EDGES)}
          {draggedSurface ? (
            <div className="pointer-events-none absolute inset-0 z-40">
              <WorkspaceEdgeDropZone
                position="top"
                disabled={!projectedSplitEligibility.workspace.vertical}
              />
              <WorkspaceEdgeDropZone
                position="right"
                disabled={!projectedSplitEligibility.workspace.horizontal}
              />
              <WorkspaceEdgeDropZone
                position="bottom"
                disabled={!projectedSplitEligibility.workspace.vertical}
              />
              <WorkspaceEdgeDropZone
                position="left"
                disabled={!projectedSplitEligibility.workspace.horizontal}
              />
            </div>
          ) : null}
          {previewRect ? (
            <div
              aria-hidden
              className="pointer-events-none absolute z-50"
              style={{
                left: `${previewRect.x * 100}%`,
                top: `${previewRect.y * 100}%`,
                width: `${previewRect.width * 100}%`,
                height: `${previewRect.height * 100}%`,
              }}
            >
              <span className="right-panel-snap-preview absolute inset-1" />
            </div>
          ) : null}
        </div>
        {typeof document === "undefined" ? dragOverlay : createPortal(dragOverlay, document.body)}
      </DndContext>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </PreviewPanelShell>
  );
}

export function RightPanelTabs(props: RightPanelTabsProps) {
  const workspace = props.workspace
    ? props.workspace
    : selectThreadRightPanelWorkspace({
        isOpen: props.activeSurfaceId !== null,
        activeSurfaceId: props.activeSurfaceId,
        surfaces: [...props.surfaces],
      });
  if (props.workspace && props.renderSurface) {
    return (
      <RightPanelWorkspace {...props} workspace={workspace} renderSurface={props.renderSurface} />
    );
  }
  return <LegacyRightPanelTabs {...props} />;
}
