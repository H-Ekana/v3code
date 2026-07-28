/**
 * Shared choreography for the workbench surfaces: the right panel shell, its
 * tab strip, and the thread terminal drawer.
 *
 * Everything that can be a pure function is one, because the `apps/web` unit
 * project runs in a Node environment (no DOM, no `act`) — pure helpers are the
 * only thing a focused test can actually assert against.
 *
 * Durations live here as the single source of truth for JS timers. The named
 * tokens in `styles/workbench.css` mirror these numbers and carry the same plan
 * citations; `workbenchChoreography.test.ts` guards the plan bands.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { getKeyboardResizedWidth, type KeyboardResizeInput } from "~/hooks/useResizableWidth";
import { useMediaQuery } from "~/hooks/useMediaQuery";

/**
 * Plan item 13: "preserve the shell through a short 180–220ms exit".
 * Plan item 16: "a deliberate 180–220ms surface launch and exit".
 * Intensity Level 2 (state handoff).
 */
export const WORKBENCH_SURFACE_TRANSITION_MS = 200;

/**
 * Plan item 13: "directionally crossfade panel content by about 4px over
 * 150–180ms". Intensity Level 2.
 */
export const WORKBENCH_CONTENT_CROSSFADE_MS = 165;

/** Plan item 13: directional crossfade offset, "about 4px". */
export const WORKBENCH_CONTENT_CROSSFADE_PX = 4;

/**
 * Plan item 16: "let the tab glyph resolve into a compact check/fade over
 * roughly 180–220ms". Intensity Level 3 (earned accent) — item 16's explicit
 * band wins over the ladder's generic 240–340ms Level 3 range, matching the
 * precedent recorded for item 9's 160–200ms Auto glint.
 */
export const WORKBENCH_CLOSE_ACKNOWLEDGMENT_MS = 200;

/** Keyboard resize step for the terminal drawer height, in pixels. */
export const TERMINAL_DRAWER_KEYBOARD_STEP = 8;
/** Shift-held keyboard resize step for the terminal drawer height, in pixels. */
export const TERMINAL_DRAWER_KEYBOARD_LARGE_STEP = 32;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}

/**
 * Read an easing curve from `motion.css` at runtime rather than duplicating the
 * literal in TypeScript, so a token change cannot silently leave a stale copy
 * behind in WAAPI keyframes.
 */
export function readMotionEasing(token: string): string {
  if (typeof window === "undefined" || typeof document === "undefined") return "ease-out";
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value.length > 0 ? value : "ease-out";
}

/* -------------------------------------------------------------------------- */
/* Surface presence                                                            */
/* -------------------------------------------------------------------------- */

/**
 * `closed` means "not present": the consumer may unmount the shell (right
 * panel) or apply `display: none` (terminal drawer). `entering`/`exiting` are
 * the bounded animation windows; `open` is the settled state.
 */
export type SurfacePhase = "closed" | "entering" | "open" | "exiting";

export interface SurfacePhaseInput {
  readonly current: SurfacePhase;
  readonly open: boolean;
  /**
   * `false` snaps straight to the settled phase. Used so a surface that changes
   * because the *thread* changed does not replay a one-shot launch/exit.
   */
  readonly animate: boolean;
}

export function nextSurfacePhase(input: SurfacePhaseInput): SurfacePhase {
  if (!input.animate) return input.open ? "open" : "closed";
  if (input.open) return input.current === "open" ? "open" : "entering";
  return input.current === "closed" ? "closed" : "exiting";
}

/** A phase that is neither settled-open nor settled-closed is mid-transition. */
export function isSurfaceTransitioning(phase: SurfacePhase): boolean {
  return phase === "entering" || phase === "exiting";
}

/**
 * Plan item 13: "make closed or exiting content inert". Deliberately *not*
 * `entering` — a launching surface is usable on its first frame, so nothing is
 * ever hidden behind choreography.
 */
export function isSurfaceInert(phase: SurfacePhase): boolean {
  return phase === "closed" || phase === "exiting";
}

export interface UseSurfacePhaseOptions {
  readonly enterMs?: number;
  readonly exitMs?: number;
  readonly animate?: boolean;
}

/**
 * Bounded presence for a surface. The `exiting` window is closed by a timer that
 * is always cleared on unmount and on re-open, so nothing expensive is retained
 * indefinitely for the sake of an animation.
 */
export function useSurfacePhase(open: boolean, options: UseSurfacePhaseOptions = {}): SurfacePhase {
  const enterMs = options.enterMs ?? WORKBENCH_SURFACE_TRANSITION_MS;
  const exitMs = options.exitMs ?? WORKBENCH_SURFACE_TRANSITION_MS;
  const animate = options.animate ?? true;

  const [phase, setPhase] = useState<SurfacePhase>(() => (open ? "open" : "closed"));
  const [previous, setPrevious] = useState({ open, animate });

  if (previous.open !== open || previous.animate !== animate) {
    setPrevious({ open, animate });
    setPhase((current) => nextSurfacePhase({ current, open, animate }));
  }

  useEffect(() => {
    if (phase === "entering") {
      if (enterMs <= 0) {
        setPhase("open");
        return;
      }
      const timer = window.setTimeout(() => setPhase("open"), enterMs);
      return () => window.clearTimeout(timer);
    }
    if (phase === "exiting") {
      if (exitMs <= 0) {
        setPhase("closed");
        return;
      }
      const timer = window.setTimeout(() => setPhase("closed"), exitMs);
      return () => window.clearTimeout(timer);
    }
    return;
  }, [enterMs, exitMs, phase]);

  return phase;
}

/* -------------------------------------------------------------------------- */
/* Tab strip                                                                    */
/* -------------------------------------------------------------------------- */

export type SurfaceTransitionDirection = "forward" | "backward" | "none";

/** Direction the user travelled through the tab strip, for a 4px crossfade. */
export function resolveSurfaceTransitionDirection(
  previousIndex: number,
  nextIndex: number,
): SurfaceTransitionDirection {
  if (previousIndex < 0 || nextIndex < 0 || previousIndex === nextIndex) return "none";
  return nextIndex > previousIndex ? "forward" : "backward";
}

/** Signed pixel offset an entering panel starts from, given a direction. */
export function crossfadeOffsetPx(direction: SurfaceTransitionDirection): number {
  if (direction === "forward") return WORKBENCH_CONTENT_CROSSFADE_PX;
  if (direction === "backward") return -WORKBENCH_CONTENT_CROSSFADE_PX;
  return 0;
}

export interface RovingTabIndexInput {
  readonly currentIndex: number;
  readonly key: string;
  readonly count: number;
}

/**
 * Roving-tabindex movement for a horizontal `tablist`. Returns `null` for keys
 * the tab strip does not own so the consumer can leave them to the browser.
 *
 * Movement only — activation stays manual (Enter/Space). WAI-ARIA recommends
 * manual activation when panels are expensive, and these panels host browser
 * views and live terminals.
 */
export function getRovingTabIndex(input: RovingTabIndexInput): number | null {
  if (input.count <= 0) return null;
  const last = input.count - 1;
  const current = Math.max(0, Math.min(last, input.currentIndex));
  switch (input.key) {
    case "ArrowRight":
      return current >= last ? 0 : current + 1;
    case "ArrowLeft":
      return current <= 0 ? last : current - 1;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

export interface TabIndicatorMetricsInput {
  /** Left edge of the scrolling tab row, in client coordinates. */
  readonly rowLeft: number;
  /** Left edge of the active tab, in client coordinates. */
  readonly tabLeft: number;
  readonly tabWidth: number;
}

export interface TabIndicatorMetrics {
  readonly left: number;
  readonly width: number;
}

/**
 * Position of the moving active-tab indicator, expressed relative to the tab
 * row so it scrolls with the tabs instead of needing a scroll offset.
 */
export function getTabIndicatorMetrics(
  input: TabIndicatorMetricsInput,
): TabIndicatorMetrics | null {
  if (!Number.isFinite(input.tabWidth) || input.tabWidth <= 0) return null;
  const left = input.tabLeft - input.rowLeft;
  if (!Number.isFinite(left)) return null;
  return { left: Math.round(left), width: Math.round(input.tabWidth) };
}

/* -------------------------------------------------------------------------- */
/* FLIP                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Inverse translation that puts an element back where it visually was, so the
 * browser can animate it home on the compositor instead of animating layout.
 */
export function getFlipTranslateX(previousCenterX: number, nextCenterX: number): number {
  if (!Number.isFinite(previousCenterX) || !Number.isFinite(nextCenterX)) return 0;
  const delta = previousCenterX - nextCenterX;
  return Math.abs(delta) < 0.5 ? 0 : delta;
}

export interface UseCenterFlipOptions {
  /** Changing this key is what triggers a measurement and a FLIP. */
  readonly key: string;
  readonly enabled: boolean;
  readonly durationMs?: number;
}

/**
 * FLIP the horizontal centre of a column whose width changes when a sibling
 * panel opens or closes. Only `transform` is animated — never `width` — so the
 * work stays on the compositor and a resize drag can never be animated.
 */
export function useCenterFlip<T extends HTMLElement>(
  options: UseCenterFlipOptions,
): (node: T | null) => void {
  const elementRef = useRef<T | null>(null);
  const previousCenterRef = useRef<number | null>(null);
  const durationMs = options.durationMs ?? WORKBENCH_SURFACE_TRANSITION_MS;
  const { enabled, key } = options;

  const setRef = useCallback((node: T | null) => {
    elementRef.current = node;
    if (node === null) previousCenterRef.current = null;
  }, []);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const previousCenter = previousCenterRef.current;
    previousCenterRef.current = center;

    if (previousCenter === null || !enabled || durationMs <= 0) return;
    if (typeof element.animate !== "function") return;
    const delta = getFlipTranslateX(previousCenter, center);
    if (delta === 0) return;

    element.animate(
      [{ transform: `translate3d(${delta}px, 0, 0)` }, { transform: "translate3d(0px, 0px, 0px)" }],
      {
        duration: durationMs,
        easing: readMotionEasing("--ease-out-quart"),
        // `backwards`, not `both`: never leave a transform on the chat column.
        fill: "backwards",
      },
    );
  }, [durationMs, enabled, key]);

  return setRef;
}

/* -------------------------------------------------------------------------- */
/* Terminal drawer                                                              */
/* -------------------------------------------------------------------------- */

export interface TerminalDrawerSeparatorProps {
  readonly role: "separator";
  readonly tabIndex: 0;
  readonly "aria-orientation": "horizontal";
  readonly "aria-label": string;
  readonly "aria-valuemin": number;
  readonly "aria-valuemax": number;
  readonly "aria-valuenow": number;
}

export function terminalDrawerSeparatorProps(input: {
  readonly height: number;
  readonly minHeight: number;
  readonly maxHeight: number;
}): TerminalDrawerSeparatorProps {
  return {
    role: "separator",
    tabIndex: 0,
    "aria-orientation": "horizontal",
    "aria-label": "Resize terminal drawer",
    "aria-valuemin": Math.round(input.minHeight),
    "aria-valuemax": Math.round(input.maxHeight),
    "aria-valuenow": Math.round(input.height),
  };
}

/**
 * Keyboard resizing for the terminal drawer. Delegates the step, large-step and
 * clamping rules to the shared `getKeyboardResizedWidth` so the drawer cannot
 * drift from the sidebar and right-panel handles; only the axis is inverted,
 * because the drawer's handle is on its *top* edge, so ArrowUp grows it.
 */
export function getKeyboardResizedHeight(
  input: Omit<KeyboardResizeInput, "currentWidth" | "minWidth" | "maxWidth"> & {
    readonly currentHeight: number;
    readonly minHeight: number;
    readonly maxHeight: number;
  },
): number | null {
  const invertedKey =
    input.key === "ArrowUp" ? "ArrowDown" : input.key === "ArrowDown" ? "ArrowUp" : input.key;
  return getKeyboardResizedWidth({
    currentWidth: input.currentHeight,
    key: invertedKey,
    minWidth: input.minHeight,
    maxWidth: input.maxHeight,
    step: input.step ?? TERMINAL_DRAWER_KEYBOARD_STEP,
    largeStep: input.largeStep ?? TERMINAL_DRAWER_KEYBOARD_LARGE_STEP,
    ...(input.useLargeStep === undefined ? {} : { useLargeStep: input.useLargeStep }),
  });
}

/**
 * Why a terminal tab disappeared.
 *
 * - `user` — the person clicked close, or used the close keybinding.
 * - `session-exit` — the shell process ended and the viewport auto-closed the
 *   tab on its behalf.
 * - `background-cleanup` — thread teardown, drawer unmount, surface
 *   reconciliation; nobody asked for it in the moment.
 */
export type TerminalCloseCause = "user" | "session-exit" | "background-cleanup";

/** The parts of a terminal session the acknowledgment gate reads. */
export interface TerminalCloseSessionState {
  /** Session status at the moment of the close. */
  readonly status: "starting" | "running" | "exited" | "error" | "closed";
  readonly exitCode: number | null;
  readonly exitSignal: number | null;
  readonly hasRunningSubprocess: boolean;
}

export interface TerminalCloseAcknowledgmentInput extends TerminalCloseSessionState {
  readonly cause: TerminalCloseCause;
}

/**
 * Re-insert a closing terminal into its group at the position it occupied, so
 * the acknowledgment plays in place instead of the remaining tabs sliding up
 * underneath it. The store has already dropped the id — this is a bounded ghost
 * that a timer removes.
 */
export function withClosingTerminalGhost(
  terminalIds: readonly string[],
  ghost: { readonly terminalId: string; readonly index: number } | null,
): readonly string[] {
  if (ghost === null || terminalIds.includes(ghost.terminalId)) return terminalIds;
  const index = Math.max(0, Math.min(terminalIds.length, ghost.index));
  return [...terminalIds.slice(0, index), ghost.terminalId, ...terminalIds.slice(index)];
}

/**
 * Gate for item 16's Level 3 accent: "on a user-initiated close of a cleanly
 * exited session, let the tab glyph resolve into a compact check/fade" — and
 * "do not celebrate ordinary command completion, forced termination, crash, or
 * background-session cleanup".
 *
 * Every clause below is one of those exclusions:
 *
 * 1. `cause !== "user"` rejects background cleanup and the auto-close that
 *    follows a process exit. Ordinary command completion never reaches here at
 *    all — it closes no tab.
 * 2. `status !== "exited"` rejects closing a *live* session. Killing a running
 *    shell is forced termination, not a clean exit. It also rejects `error`
 *    (crash / attach failure) and `starting`.
 * 3. `exitSignal !== null` rejects a session that died from a signal, which is
 *    how a forced kill reports itself even when the status settles to `exited`.
 * 4. `exitCode !== 0` rejects a failing exit status.
 * 5. `hasRunningSubprocess` rejects a session whose child process is still
 *    alive, so nothing in flight is celebrated as finished.
 */
export function shouldAcknowledgeTerminalClose(input: TerminalCloseAcknowledgmentInput): boolean {
  if (input.cause !== "user") return false;
  if (input.status !== "exited") return false;
  if (input.exitSignal !== null) return false;
  if (input.exitCode !== 0) return false;
  if (input.hasRunningSubprocess) return false;
  return true;
}

/**
 * Reasons an xterm refit is allowed. Deliberately an explicit list of
 * *checkpoints*: there is no "animation frame" or "height changed" member, so a
 * per-frame refit cannot be expressed.
 */
export type TerminalRefitReason =
  | "drag-end"
  | "keyboard-resize"
  | "window-resize"
  | "visibility-enter"
  | "transition-end"
  | "height-settled";

/**
 * Plan item 16: "refit xterm at transition boundaries and resize checkpoints
 * rather than on every animation frame". A height change that arrives while the
 * pointer is still down is a frame of a drag, not a checkpoint.
 */
export function shouldRefitTerminal(input: {
  readonly reason: TerminalRefitReason;
  readonly dragging: boolean;
}): boolean {
  if (input.reason === "height-settled") return !input.dragging;
  return true;
}
