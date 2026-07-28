// ---------------------------------------------------------------------------
// Send-morph: the just-sent message lifts out of the composer and lands as the
// new user bubble.
//
// On send we already mount an *optimistic* user bubble at the live edge (keyed
// on the outgoing message id, so the server echo reconciles it away without a
// duplicate — see `mergeOptimisticUserMessages`). That half works and is kept.
//
// The *motion* is a hand-built flyer driven by a `requestAnimationFrame` loop.
// We do NOT clone the composer subtree (the Lexical editor, footer, model
// picker, and round send button) — that put hundreds of nodes on one composited
// layer and lagged. Instead we build a single `<div>` from scratch that carries
// only the sent text, styled to read as the message leaving the composer, and
// fly *that* into the arriving bubble. Tens of nodes become one element + a text
// node.
//
// The flight is live-retargeted: every frame samples the arriving bubble's
// *current* box (one `getBoundingClientRect` on one element) and eases the flyer
// toward it. So when the timeline shifts mid-flight — the reply streams in and
// the follow-end scroll advances — the flyer bends to the true landing spot
// instead of landing where the bubble used to be. The real bubble is hidden from
// the moment it mounts and crossfades in over the final leg while the flyer
// fades out, so the two read as one object; the flyer ends exactly on the
// bubble's current box.
//
// Every precondition is a graceful enhancement over the plain
// `.conversation-user-arrival` CSS rise: no `requestAnimationFrame` (SSR /
// headless), reduced motion, or a missing surface all fall back to an instant
// append with that arrival. The flight is a singleton — a second send, a thread
// switch, or an unmount retires the live flyer immediately and always clears the
// bubble's inline styles, so a flyer can never be stranded.
// ---------------------------------------------------------------------------

import { extractTrailingConversationReferences } from "../../conversationReference";

/** The just-sent bubble carries this attribute while the lifecycle ledger flags
 *  it `isArriving` — the deterministic hook the flight lands on. */
const SEND_MORPH_ARRIVAL_ATTR = "data-user-turn-arrival";

/** The composer's text area within the surface — the flyer lifts from where the
 *  text sits, not from the whole composer frame. */
const SEND_MORPH_EDITOR_SELECTOR = '[data-testid="composer-editor"]';

/** Static "glass" look for the flyer (translucent surface, rounded corners,
 *  border, shadow, z-index). Geometry, font, and motion are inline; only the
 *  look lives in `conversation.css`. */
const SEND_MORPH_FLYER_CLASS = "conversation-send-flyer";

/** Total flight length. Slower than the old 600ms so the travel reads as smooth
 *  rather than a skip; the decelerating ease spends most of it near the bubble. */
const SEND_MORPH_TRAVEL_MS = 700;
/** The crossfade owns the final fraction of the flight: the flyer fades out and
 *  the real bubble fades in over this window so the two read as one object. */
const SEND_MORPH_CROSSFADE_FRACTION = 0.6;
/** If the bubble never lands, dissolve the flyer in place rather than strand it. */
const SEND_MORPH_FALLBACK_FADE_MS = 180;
/** Landing poll cap (~10 frames / ~160ms). Under the arrival TTL (260ms) so the
 *  hook is always present while we look; imperceptible with the flyer covering
 *  the composer. */
const SEND_MORPH_LAND_POLL_MAX_FRAMES = 10;

/** Cap the flyer's content so a very long draft never flies as a tall slab. */
const SEND_MORPH_MAX_LINES = 6;
const SEND_MORPH_FALLBACK_LINE_PX = 22;

/** Above the timeline and the sticky composer chrome (so it hides the composer
 *  clear), yet below any dialog/backdrop (see `--layer-*` in motion.css). Set
 *  inline so the flyer layers correctly even before the class resolves. */
const SEND_MORPH_FLYER_Z_INDEX = "calc(var(--layer-backdrop) - 1)";

/** Strongly decelerating ease (mirrors `--ease-out-quint`) — a long settling
 *  tail into the bubble rather than a front-loaded pop. */
function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * True only when the browser can drive the flyer flight right now: a live
 * composer surface exists to lift from, the OS is not asking for reduced motion,
 * and `requestAnimationFrame` is available to drive the loop. Anything false
 * means the caller should just run the commit and let the CSS arrival be the
 * visible handoff.
 */
export function canRunSendMorph(surface: HTMLElement | null): surface is HTMLElement {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  if (surface === null) return false;
  if (prefersReducedMotion()) return false;
  return typeof window.requestAnimationFrame === "function";
}

type SendMorphPhase = "seeking" | "flying" | "fallback";

interface ActiveSendMorph {
  readonly flyer: HTMLElement;
  /** The box the flyer lifts from (the editor's text area) and the scale base. */
  readonly startLeft: number;
  readonly startTop: number;
  readonly startWidth: number;
  readonly startHeight: number;
  phase: SendMorphPhase;
  bubble: HTMLElement | null;
  seekFrames: number;
  /** The rAF timestamp at which the current timed phase (flying / fallback) began. */
  phaseStart: number;
  rafId: number | null;
}

/** The one flight in the air, or null. Everything is retired through here. */
let active: ActiveSendMorph | null = null;

/**
 * Retire the live flyer flight, if any: stop the rAF loop, remove the flyer from
 * the body, and restore the bubble's inline styles. Idempotent and safe to call
 * re-entrantly (it clears `active` first), from a second send, a thread switch,
 * an unmount, or a natural finish.
 */
export function retireSendMorph(): void {
  const current = active;
  if (!current) return;
  active = null;

  if (current.rafId !== null) {
    cancelAnimationFrame(current.rafId);
  }
  current.flyer.remove();

  const { bubble } = current;
  if (bubble) {
    bubble.style.opacity = "";
    bubble.style.animation = "";
    bubble.style.willChange = "";
  }
}

/**
 * Build the flyer from scratch: a single `<div>` carrying only the sent text
 * (plain text, references block stripped the way the timeline derives its
 * display text), styled to read as the message leaving the composer. A handful
 * of computed styles are copied from the editor's text area — never a subtree
 * clone. Geometry + font are inline; the translucent surface look is the CSS
 * class.
 */
function buildFlyer(
  editor: HTMLElement,
  rect: { left: number; top: number; width: number; height: number },
  boxHeight: number,
  text: string,
): HTMLElement {
  const flyer = document.createElement("div");
  flyer.className = SEND_MORPH_FLYER_CLASS;
  flyer.setAttribute("aria-hidden", "true");
  flyer.setAttribute("inert", "");
  flyer.textContent = text;

  const cs = window.getComputedStyle(editor);
  const s = flyer.style;
  s.position = "fixed";
  s.left = `${rect.left}px`;
  s.top = `${rect.top}px`;
  s.width = `${rect.width}px`;
  s.height = `${boxHeight}px`;
  s.margin = "0";
  s.transformOrigin = "top left";
  s.transform = "translate3d(0, 0, 0)";
  s.zIndex = SEND_MORPH_FLYER_Z_INDEX;
  s.pointerEvents = "none";
  // A handful of computed styles from the editor — font + text metrics + padding
  // — so the text reads exactly as it did in the composer. Not the whole tree.
  s.fontFamily = cs.fontFamily;
  s.fontSize = cs.fontSize;
  s.fontWeight = cs.fontWeight;
  s.lineHeight = cs.lineHeight;
  s.letterSpacing = cs.letterSpacing;
  s.color = cs.color;
  s.textAlign = cs.textAlign;
  s.paddingTop = cs.paddingTop;
  s.paddingRight = cs.paddingRight;
  s.paddingBottom = cs.paddingBottom;
  s.paddingLeft = cs.paddingLeft;
  return flyer;
}

/**
 * Wrap the synchronous send commit (mount the optimistic bubble + clear the
 * composer) in a flyer flight so the message morphs out of the composer into the
 * bubble. Falls back to running `commit` directly when the morph cannot run.
 * Never scrolls — the timeline's own minimal-scroll behavior is left untouched.
 */
export function runSendMorphTransition(
  surface: HTMLElement | null,
  messageText: string,
  commit: () => void,
): void {
  if (!canRunSendMorph(surface)) {
    commit();
    return;
  }

  // Singleton: a second send retires the previous flight instantly.
  retireSendMorph();

  let flight: ActiveSendMorph;
  try {
    // Lift from the editor's text area, not the whole composer frame. The whole
    // surface is the fallback if the editor cannot be found.
    const editor = surface.querySelector<HTMLElement>(SEND_MORPH_EDITOR_SELECTOR) ?? surface;
    const rect = editor.getBoundingClientRect();
    const boxHeight = cappedFlyerHeight(editor, rect.height);
    const text = extractTrailingConversationReferences(messageText).promptText;
    const flyer = buildFlyer(editor, rect, boxHeight, text);
    document.body.appendChild(flyer);
    flight = {
      flyer,
      startLeft: rect.left,
      startTop: rect.top,
      startWidth: rect.width,
      startHeight: boxHeight,
      phase: "seeking",
      bubble: null,
      seekFrames: 0,
      phaseStart: 0,
      rafId: null,
    };
    active = flight;
  } catch {
    // Building/measuring failed — never leave a partial flyer behind.
    retireSendMorph();
    commit();
    return;
  }

  // Commit on React's own schedule (no flushSync): the optimistic bubble mounts
  // and the composer clears while the flyer covers the composer area.
  commit();

  const frame = makeFrame(flight);
  flight.rafId = requestAnimationFrame(frame);
}

/** Cap the flyer box to ~6 lines so a long draft never flies as a tall slab. */
function cappedFlyerHeight(editor: HTMLElement, rectHeight: number): number {
  const cs = window.getComputedStyle(editor);
  const lineHeight = Number.parseFloat(cs.lineHeight);
  const fontSize = Number.parseFloat(cs.fontSize);
  const line = Number.isFinite(lineHeight)
    ? lineHeight
    : Number.isFinite(fontSize)
      ? fontSize * 1.5
      : SEND_MORPH_FALLBACK_LINE_PX;
  const padTop = Number.parseFloat(cs.paddingTop) || 0;
  const padBottom = Number.parseFloat(cs.paddingBottom) || 0;
  const cap = line * SEND_MORPH_MAX_LINES + padTop + padBottom;
  // `rectHeight` can be 0 in headless/detached measurement; fall back to the cap
  // so the flyer still has a sane box.
  return rectHeight > 0 ? Math.min(rectHeight, cap) : cap;
}

/** The single rAF loop that drives every phase of one flight. One closure is
 *  built per flight and reused for every frame — no per-frame allocation. */
function makeFrame(flight: ActiveSendMorph): FrameRequestCallback {
  const frame: FrameRequestCallback = (now) => {
    if (active !== flight) return;
    flight.rafId = null;
    const finished = advanceFlight(flight, now);
    // `advanceFlight` retires (clearing `active`) when the flight is done; only
    // reschedule while this flight is still the live one.
    if (!finished && active === flight) {
      flight.rafId = requestAnimationFrame(frame);
    }
  };
  return frame;
}

/** Advance one frame. Returns true once the flight has retired and must stop. */
function advanceFlight(flight: ActiveSendMorph, now: number): boolean {
  switch (flight.phase) {
    case "seeking": {
      const bubble = document.querySelector<HTMLElement>(`[${SEND_MORPH_ARRIVAL_ATTR}="true"]`);
      if (bubble) {
        beginFlight(flight, bubble, now);
        return false;
      }
      flight.seekFrames += 1;
      if (flight.seekFrames >= SEND_MORPH_LAND_POLL_MAX_FRAMES) {
        beginFallback(flight, now);
      }
      return false;
    }
    case "flying":
      return stepFlight(flight, now);
    case "fallback": {
      // Dissolve the flyer in place — the bubble was never touched, so its own
      // CSS arrival rise stands.
      const t = clamp01((now - flight.phaseStart) / SEND_MORPH_FALLBACK_FADE_MS);
      flight.flyer.style.opacity = `${1 - t}`;
      if (t >= 1) {
        retireSendMorph();
        return true;
      }
      return false;
    }
  }
}

/** The bubble landed: hide it, suppress its CSS arrival, and start the timed flight. */
function beginFlight(flight: ActiveSendMorph, bubble: HTMLElement, now: number): void {
  // Hide the real bubble from first paint and suppress its CSS rise so the flyer
  // is the only thing the eye tracks until the crossfade. The arrival TTL
  // (260ms) is well under the travel, so the `.conversation-user-arrival` class
  // is gone before cleanup clears `animation` — clearing it cannot restart it.
  bubble.style.opacity = "0";
  bubble.style.animation = "none";
  bubble.style.willChange = "opacity";
  flight.bubble = bubble;
  flight.phase = "flying";
  flight.phaseStart = now;
}

/**
 * One flight frame. Live-retargets: samples the bubble's *current* box and eases
 * the flyer toward it, so a mid-flight shift (streaming reply advancing the
 * scroll) bends the flyer to the true landing spot. Per-frame work is tiny — one
 * rect read, then transform + opacity writes only, no layout writes. Returns
 * true once the flight has retired.
 */
function stepFlight(flight: ActiveSendMorph, now: number): boolean {
  const bubble = flight.bubble;
  // A detached bubble (virtualization evicting the row mid-flight) measures as a
  // zero rect at (0,0) — the flyer would glide toward the viewport origin.
  // Retire instead; the bubble's inline styles are cleared on the way out.
  if (!bubble || !bubble.isConnected) {
    retireSendMorph();
    return true;
  }

  const t = clamp01((now - flight.phaseStart) / SEND_MORPH_TRAVEL_MS);
  const e = easeOutQuint(t);

  // The one read this frame: the bubble's live box. Nothing we write below
  // invalidates layout, so this never forces a synchronous relayout on its own.
  const b = bubble.getBoundingClientRect();

  const dx = (b.left - flight.startLeft) * e;
  const dy = (b.top - flight.startTop) * e;
  const sx = flight.startWidth > 0 ? 1 + (b.width / flight.startWidth - 1) * e : 1;
  const sy = flight.startHeight > 0 ? 1 + (b.height / flight.startHeight - 1) * e : 1;
  flight.flyer.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`;

  // Crossfade over the final leg: flyer out, bubble in — the two become one.
  if (t >= SEND_MORPH_CROSSFADE_FRACTION) {
    const f = clamp01((t - SEND_MORPH_CROSSFADE_FRACTION) / (1 - SEND_MORPH_CROSSFADE_FRACTION));
    flight.flyer.style.opacity = `${1 - f}`;
    bubble.style.opacity = `${f}`;
  }

  if (t >= 1) {
    // Landed exactly on the bubble's current box; hand off to the real bubble.
    retireSendMorph();
    return true;
  }
  return false;
}

/** The bubble never appeared within the cap: switch to an in-place dissolve. */
function beginFallback(flight: ActiveSendMorph, now: number): void {
  flight.phase = "fallback";
  flight.phaseStart = now;
}

/**
 * Reconcile optimistic user messages against the authoritative server list.
 *
 * The optimistic bubble is inserted synchronously at the send instant keyed on
 * the outgoing message id. When the server echo arrives carrying that same id,
 * the optimistic copy is dropped here so the timeline shows exactly one bubble —
 * no duplicate, no flicker. Referential identity of `serverMessages` is
 * preserved whenever nothing pending remains, so downstream memoization stays
 * stable across streaming ticks.
 */
export function mergeOptimisticUserMessages<T extends { id: string }>(
  serverMessages: ReadonlyArray<T>,
  optimisticMessages: ReadonlyArray<T>,
): ReadonlyArray<T> {
  if (optimisticMessages.length === 0) {
    return serverMessages;
  }
  const serverIds = new Set(serverMessages.map((message) => message.id));
  const pendingMessages = optimisticMessages.filter((message) => !serverIds.has(message.id));
  if (pendingMessages.length === 0) {
    return serverMessages;
  }
  return [...serverMessages, ...pendingMessages];
}
