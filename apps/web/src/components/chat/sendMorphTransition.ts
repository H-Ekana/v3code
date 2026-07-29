// ---------------------------------------------------------------------------
// Send-morph: the just-sent message lifts out of the composer and lands as the
// new user bubble.
//
// On send we already mount an *optimistic* user bubble at the live edge (keyed
// on the outgoing message id, so the server echo reconciles it away without a
// duplicate — see `mergeOptimisticUserMessages`). That half works and is kept.
//
// The *motion* is a hand-built flyer driven by a `requestAnimationFrame` loop —
// a *container transform* (the Material pattern): one fixed-position container
// whose visible box morphs from the composer's rect to the bubble's rect while
// two fixed-layout content layers fade through inside it.
//
// We do NOT clone the composer subtree (the Lexical editor, footer, model
// picker, and round send button) — that put hundreds of nodes on one composited
// layer and lagged. The *outgoing* layer is a single `<div>` built from the sent
// text, laid out exactly as it read in the composer. The *incoming* layer is a
// one-time clone of the arriving bubble itself (a small subtree: the text plus
// any attachment thumbnails, whose blob URLs are already decoded from the
// composer preview), so the flyer's landing state is pixel-identical to the real
// bubble — attachments fly with the box instead of popping in afterwards.
//
// The box morph is `clip-path: inset(… round r)` on the container, NOT
// width/height: the container is sized once (at landing detection) to the union
// of both rects, and every frame only rewrites `transform` + `clip-path` +
// layer opacities. Nothing is ever laid out per frame, nothing is ever scaled —
// text stays sharp, images keep their aspect, and the whole flight stays off
// the layout pipeline (the one read per frame is the bubble's rect).
//
// The flight is live-retargeted: every frame samples the arriving bubble's
// *current* box (one `getBoundingClientRect` on one element) and eases the flyer
// toward it. So when the timeline shifts mid-flight — the reply streams in and
// the follow-end scroll advances — the flyer bends to the true landing spot
// instead of landing where the bubble used to be. The real bubble is hidden from
// the moment it mounts and crossfades in only over the final leg, with the flyer
// fading out slightly *ahead* of the bubble fading in, so two full-strength
// copies are never simultaneously visible; the flyer ends exactly on the
// bubble's current box.
//
// Every precondition is a graceful enhancement over the plain
// `.conversation-user-arrival` CSS rise: no `requestAnimationFrame` (SSR /
// headless), reduced motion, or a missing surface all fall back to an instant
// append with that arrival. The flight is a singleton — a second send, a thread
// switch, or an unmount retires the live flyer immediately and always clears the
// bubble's inline styles, so a flyer can never be stranded.
//
// Two theme touches ride the flight, both built so they cost nothing extra per
// frame — the per-frame budget stays AT MOST one rect read plus transform /
// clip-path / opacity writes, and no shadow, filter, or backdrop-filter is ever
// animated:
//
//   1. Charged-send wash — a faint violet→pink linear-gradient on the OUTGOING
//      layer. It rides that layer's existing 0→0.18 opacity ramp, so it is a
//      pure static background: zero new per-frame writes, and it can never tint
//      the incoming bubble clone or the landed bubble (both are separate nodes).
//   2. Landing glint — a one-shot border pulse on the real bubble, armed only
//      when the flight completes naturally (t>=1), never on an interrupted
//      retirement or the never-landed dissolve. Pure CSS once armed.
//
// (A third touch — a velocity-keyed comet trail behind the flyer — shipped and
// was removed: it read as janky in real use and was the only extra composited
// layer the flight carried.)
//
// Two per-frame economies keep the loop lean at 60fps:
//   • The bubble's rect — the loop's only layout read, and the only thing in it
//     that can force a layout flush when something else (a streaming commit, an
//     image decode) dirtied layout this frame — is sampled on alternate frames
//     over the early travel and every frame over the final leg, where the
//     landing must be exact. A ≤33ms retarget lag is invisible on a strongly
//     decelerating ease; halving the reads halves the worst-case flush cost.
//   • Every style write is deduplicated against the last written value
//     (transform and clip-path strings are rounded to 0.01px first), so the
//     long settling tail — where per-frame deltas fall below a hundredth of a
//     pixel — stops touching the DOM entirely.
// ---------------------------------------------------------------------------

import { extractTrailingConversationReferences } from "../../conversationReference";

/** The just-sent bubble carries this attribute while the lifecycle ledger flags
 *  it `isArriving` — the deterministic hook the flight lands on. */
const SEND_MORPH_ARRIVAL_ATTR = "data-user-turn-arrival";

/** Set alongside the arrival hook with the row's message id, so a flight can
 *  bind to the exact turn it sent instead of the first arrival in the DOM. */
const SEND_MORPH_ARRIVAL_ID_ATTR = "data-user-turn-arrival-id";

/** The composer's text area within the surface — the flyer lifts from where the
 *  text sits, not from the whole composer frame. */
const SEND_MORPH_EDITOR_SELECTOR = '[data-testid="composer-editor"]';

/** Static "glass" look for the flyer (translucent surface, rounded corners,
 *  border, shadow, z-index). Geometry, font, and motion are inline; only the
 *  look lives in `conversation.css`. */
const SEND_MORPH_FLYER_CLASS = "conversation-send-flyer";

/** The charged-send wash: a faint violet→pink gradient carried by the OUTGOING
 *  layer, so it fades out on that layer's existing ramp (t=0→0.18, ~125ms) with
 *  no per-frame write of its own. On the outgoing layer specifically — never the
 *  container — so the bubble clone and the landed bubble stay untinted. */
const SEND_MORPH_CHARGE_CLASS = "conversation-send-flyer-charge";

/** The one-shot landing pulse on the real bubble, and the keyframe name it
 *  runs. Only a matching `animationend` clears the class: an `animationend` from
 *  a descendant (markdown, tool chrome) bubbles up to the same listener and
 *  would otherwise strip the glint a frame after it armed. */
const SEND_MORPH_GLINT_CLASS = "conversation-user-landing-glint";
const SEND_MORPH_GLINT_ANIMATION = "conversation-user-landing-glint";

/** Total flight length. Slower than the old 600ms so the travel reads as smooth
 *  rather than a skip; the decelerating ease spends most of it near the bubble. */
const SEND_MORPH_TRAVEL_MS = 700;
/** The crossfade owns only the final sliver of the flight — by then the flyer
 *  (already laid out at the bubble's own geometry) sits essentially on top of
 *  the bubble, so the swap is invisible. A wide window here is what used to
 *  produce visible doubled text: both copies on screen for hundreds of ms. */
const SEND_MORPH_CROSSFADE_FRACTION = 0.85;
/** The flyer's fade-out completes here, before the bubble's fade-in completes
 *  at t=1 — the offset ramps guarantee the combined opacity never reads as two
 *  full-strength copies. */
const SEND_MORPH_FLYER_FADE_END = 0.95;
/** Content fade-through inside the morphing container: the composer-wrapped
 *  outgoing text is fully out by here… */
const SEND_MORPH_CONTENT_FADE_OUT_END = 0.18;
/** …while the bubble-layout incoming layer ramps in over this window. The tiny
 *  overlap (0.12–0.18) is ~40ms during the fastest leg of the ease — motion
 *  masks it, so differently-wrapped copies never read as doubled text. */
const SEND_MORPH_CONTENT_FADE_IN_START = 0.12;
const SEND_MORPH_CONTENT_FADE_IN_END = 0.38;
/** From here to touchdown the bubble's rect is sampled EVERY frame so the
 *  landing is pixel-exact; before it, alternate frames suffice — the eye cannot
 *  see a one-frame retarget lag while the ease is still covering real distance,
 *  and each skipped read is one fewer chance to force a dirty-layout flush. */
const SEND_MORPH_EXACT_RETARGET_FRACTION = 0.7;
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

/** Linear 0→1 ramp of `t` across [from, to], clamped. */
function ramp(t: number, from: number, to: number): number {
  return clamp01((t - from) / (to - from));
}

/** Round to 0.01px before serializing into a style string: sub-hundredth
 *  deltas are invisible, and rounding is what lets the write-dedup catch the
 *  whole settling tail (where per-frame movement drops below a pixel). Integers
 *  serialize without a trailing ".00", so rounded strings stay compact. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
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
  /** The morphing container: fixed position, sized to the union box at landing
   *  detection, then driven by transform + clip-path + opacity only. */
  readonly flyer: HTMLElement;
  /** Outgoing content layer: the sent text at the composer's own layout. */
  readonly outgoing: HTMLElement;
  /** Incoming content layer: a one-time clone of the landing bubble (text +
   *  attachment thumbnails), appended the moment the bubble is found. */
  incoming: HTMLElement | null;
  /** The just-sent message's id — binds the landing seek to the turn that was
   *  actually sent, so a stale arrival hook elsewhere can never be adopted. */
  readonly messageId: string | null;
  /** The fixed box the flyer lifts from (the editor's text area). The per-frame
   *  transform is a pure translation away from this point; the visible box
   *  interpolates from this size to the bubble's live size via clip-path. */
  readonly startLeft: number;
  readonly startTop: number;
  readonly startWidth: number;
  readonly startHeight: number;
  /** Corner radii for the clip's `round`, captured at landing detection. */
  startRadius: number;
  targetRadius: number;
  /** The container's union size — the clip insets are measured from it. Grows
   *  (rarely) if the live bubble outgrows the box captured at landing, e.g. an
   *  attachment image finishing decode mid-flight. */
  unionWidth: number;
  unionHeight: number;
  /** The cached landing box — refreshed by the sampled rect reads, consumed by
   *  every frame. A zero-sized measurement (a virtualized row mid-recycle)
   *  never replaces it, so the flight always steers toward a real box. */
  targetLeft: number;
  targetTop: number;
  targetWidth: number;
  targetHeight: number;
  /** Frames flown so far — drives the alternate-frame rect sampling. */
  flightFrame: number;
  /** Last written style values — identical writes are skipped, which silences
   *  the whole settling tail once rounded deltas reach zero. */
  lastOutgoingOpacity: number;
  lastIncomingOpacity: number;
  lastTransform: string;
  lastClipPath: string;
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
 * Retire the live flyer flight, if any: stop the rAF loop, remove the flyer and
 * its trail from the body, and restore the bubble's inline styles. Idempotent
 * and safe to call re-entrantly (it clears `active` first), from a second send,
 * a thread switch, an unmount, or a natural finish.
 *
 * Deliberately silent about the landing glint: retirement is not a landing.
 * Only the natural t>=1 completion arms it (see `stepFlight`), and it does so
 * *after* calling this, so clearing the bubble's inline `animation` here cannot
 * cancel it.
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
 * Build the morphing container + its outgoing content layer from scratch. The
 * outgoing layer is a single `<div>` carrying only the sent text (plain text,
 * references block stripped the way the timeline derives its display text),
 * laid out exactly as it read in the composer: a handful of computed styles are
 * copied from the editor's text area — never a subtree clone. The container
 * carries geometry + the translucent glass look (CSS class); the layer is
 * absolutely positioned at a fixed pixel width, so nothing inside the container
 * ever reflows while the box morphs around it.
 */
function buildFlyer(
  cs: CSSStyleDeclaration,
  rect: { left: number; top: number; width: number; height: number },
  boxHeight: number,
  text: string,
): { flyer: HTMLElement; outgoing: HTMLElement } {
  const flyer = document.createElement("div");
  flyer.className = SEND_MORPH_FLYER_CLASS;
  flyer.setAttribute("aria-hidden", "true");
  flyer.setAttribute("inert", "");

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

  const outgoing = document.createElement("div");
  outgoing.textContent = text;
  // The charged-send wash lives on THIS layer, not the container: the layer
  // already fades 1→0 over t=0→0.18, so the tint is visible at lift-off and gone
  // ~125ms later for free — no new per-frame style write, and nothing to undo.
  // Putting it on the container instead would tint the bubble clone as it faded
  // in and would need its own ramp.
  outgoing.className = SEND_MORPH_CHARGE_CLASS;
  const o = outgoing.style;
  o.position = "absolute";
  o.top = "0";
  o.left = "0";
  // Stretched to the container's height so the wash fills the flown box rather
  // than only the text's own line box. Height is never read or written here —
  // the layer resolves against the container, whose one-time size write already
  // exists — so this adds no per-frame layout.
  o.bottom = "0";
  o.width = `${rect.width}px`;
  o.boxSizing = "border-box";
  o.willChange = "opacity";
  // Composer text behavior lives HERE, not on the container — the incoming
  // bubble clone must never inherit it, or its text would wrap differently
  // from the real bubble and the final crossfade would visibly shift.
  o.whiteSpace = "pre-wrap";
  o.overflowWrap = "anywhere";
  // A handful of computed styles from the editor — font + text metrics + padding
  // — so the text reads exactly as it did in the composer. Not the whole tree.
  o.fontFamily = cs.fontFamily;
  o.fontSize = cs.fontSize;
  o.fontWeight = cs.fontWeight;
  o.lineHeight = cs.lineHeight;
  o.letterSpacing = cs.letterSpacing;
  o.color = cs.color;
  o.textAlign = cs.textAlign;
  o.paddingTop = cs.paddingTop;
  o.paddingRight = cs.paddingRight;
  o.paddingBottom = cs.paddingBottom;
  o.paddingLeft = cs.paddingLeft;
  flyer.appendChild(outgoing);
  return { flyer, outgoing };
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
  messageId?: string,
): void {
  // Singleton: any new send — even one that cannot fly — retires the previous
  // flight instantly, so a live flyer never outlasts the turn it belonged to.
  retireSendMorph();

  if (!canRunSendMorph(surface)) {
    commit();
    return;
  }

  let flight: ActiveSendMorph;
  try {
    // Lift from the editor's text area, not the whole composer frame. The whole
    // surface is the fallback if the editor cannot be found.
    const editor = surface.querySelector<HTMLElement>(SEND_MORPH_EDITOR_SELECTOR) ?? surface;
    const rect = editor.getBoundingClientRect();
    const editorStyles = window.getComputedStyle(editor);
    const boxHeight = cappedFlyerHeight(editorStyles, rect.height);
    const text = extractTrailingConversationReferences(messageText).promptText;
    const { flyer, outgoing } = buildFlyer(editorStyles, rect, boxHeight, text);
    document.body.appendChild(flyer);
    flight = {
      flyer,
      outgoing,
      incoming: null,
      messageId: messageId ?? null,
      startLeft: rect.left,
      startTop: rect.top,
      startWidth: rect.width,
      startHeight: boxHeight,
      startRadius: 0,
      targetRadius: 0,
      unionWidth: rect.width,
      unionHeight: boxHeight,
      targetLeft: rect.left,
      targetTop: rect.top,
      targetWidth: rect.width,
      targetHeight: boxHeight,
      flightFrame: 0,
      lastOutgoingOpacity: 1,
      lastIncomingOpacity: 0,
      lastTransform: "",
      lastClipPath: "",
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
  // and the composer clears while the flyer covers the composer area. A commit
  // that throws must not strand the flyer (the rAF loop is only scheduled
  // after it) — retire on the way out and let the error propagate.
  try {
    commit();
  } catch (error) {
    retireSendMorph();
    throw error;
  }

  const frame = makeFrame(flight);
  flight.rafId = requestAnimationFrame(frame);
}

/** Cap the flyer box to ~6 lines so a long draft never flies as a tall slab. */
function cappedFlyerHeight(cs: CSSStyleDeclaration, rectHeight: number): number {
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
      const bubble = findArrivingBubble(flight.messageId);
      if (bubble) {
        // A just-mounted row can measure as a zero box for a frame; landing on
        // a degenerate rect would freeze a zero-width clone and clip. Keep
        // seeking (the poll budget covers it) until the box is real.
        const rect = bubble.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          beginFlight(flight, bubble, rect, now);
          return false;
        }
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

/**
 * Find the arriving bubble for THIS send. The lifecycle ledger can flag more
 * than one arrival during its TTL (rapid consecutive sends), so when the send
 * carries a message id, only the hook whose row matches it is accepted — the
 * seek keeps polling rather than adopt someone else's bubble. Without an id
 * (legacy call), the first hook stands. The hook list is 1–2 elements.
 */
function findArrivingBubble(messageId: string | null): HTMLElement | null {
  const hooks = document.querySelectorAll<HTMLElement>(`[${SEND_MORPH_ARRIVAL_ATTR}="true"]`);
  if (messageId === null) return hooks[0] ?? null;
  for (const hook of hooks) {
    if (hook.getAttribute(SEND_MORPH_ARRIVAL_ID_ATTR) === messageId) return hook;
  }
  return null;
}

/**
 * Turn a fresh clone of the landing bubble into the flyer's incoming content
 * layer: pinned to the container's top-left at the bubble's own pixel width, so
 * it lays out exactly once, identically to the real bubble, and never reflows
 * while the box morphs. The clone is taken BEFORE the bubble is hidden, so no
 * inline flight styles ride along; the landing hook + arrival class + message
 * ids are stripped so the clone can never be mistaken for a real timeline row.
 */
function prepareIncomingLayer(clone: HTMLElement, widthPx: number): void {
  clone.removeAttribute(SEND_MORPH_ARRIVAL_ATTR);
  clone.removeAttribute(SEND_MORPH_ARRIVAL_ID_ATTR);
  clone.classList.remove("conversation-user-arrival");
  clone.removeAttribute("data-message-id");
  clone.removeAttribute("id");
  for (const el of clone.querySelectorAll("[data-message-id]")) {
    el.removeAttribute("data-message-id");
  }
  // Cloning duplicates DOM ids (markdown heading anchors, control ids) — scrub
  // them so `getElementById` and IDREF lookups can never resolve to the flyer.
  for (const el of clone.querySelectorAll("[id]")) {
    el.removeAttribute("id");
  }
  const s = clone.style;
  s.position = "absolute";
  s.top = "0";
  s.left = "0";
  s.width = `${widthPx}px`;
  s.maxWidth = "none";
  s.margin = "0";
  s.opacity = "0";
  s.animation = "none";
  s.pointerEvents = "none";
  s.willChange = "opacity";
}

/**
 * Arm the one-shot landing glint on the real bubble. Called ONLY from the
 * natural t>=1 completion — an interrupted retirement (second send, thread
 * switch, unmount) or the never-landed fallback dissolve must not celebrate a
 * landing that did not happen — and only ever *after* `retireSendMorph`, which
 * is what makes the sequencing safe:
 *
 *   • Retirement clears the bubble's inline `opacity`/`animation`/`will-change`.
 *     Arming first would mean that cleanup wiped the glint one statement later.
 *   • The glint animates a `::after` pseudo-element, never the bubble's own
 *     `animation` property. So it cannot restart `.conversation-user-arrival`'s
 *     rise (whose 260ms TTL has long since dropped the class anyway by the end
 *     of a 700ms flight), and clearing inline `animation` on the element leaves
 *     the pseudo untouched.
 *   • The crossfade's last write leaves the bubble at inline opacity; retirement
 *     has already reset it to "" before this runs, so nothing fights over it.
 *
 * The class is removed on the glint's OWN `animationend`. `animationend` from a
 * descendant bubbles to this same listener, so `{ once: true }` alone would let
 * an unrelated animation strip the glint mid-pulse; the handler filters by
 * animation name and detaches itself on the real one instead. The listener lives
 * on the bubble, so a bubble removed before the animation ends is collected with
 * its listener — nothing to leak.
 */
function armLandingGlint(bubble: HTMLElement): void {
  if (!bubble.isConnected) return;
  const onEnd = (event: AnimationEvent): void => {
    if (event.animationName !== SEND_MORPH_GLINT_ANIMATION) return;
    bubble.removeEventListener("animationend", onEnd);
    bubble.classList.remove(SEND_MORPH_GLINT_CLASS);
  };
  bubble.addEventListener("animationend", onEnd);
  bubble.classList.add(SEND_MORPH_GLINT_CLASS);
}

/** Write the container's visible box: a clip-path inset measured from the
 *  union box, rounded at the interpolated radius. Paint-level only — the
 *  layers inside never see it, so nothing reflows, ever. Values are rounded to
 *  0.01px and the serialized string is deduplicated, so once the settling tail
 *  stops moving the box perceptibly, it stops touching the DOM at all. */
function applyBoxClip(flight: ActiveSendMorph, vw: number, vh: number, vr: number): void {
  const right = round2(Math.max(0, flight.unionWidth - vw));
  const bottom = round2(Math.max(0, flight.unionHeight - vh));
  const clipPath = `inset(0px ${right}px ${bottom}px 0px round ${round2(vr)}px)`;
  if (clipPath !== flight.lastClipPath) {
    flight.lastClipPath = clipPath;
    flight.flyer.style.clipPath = clipPath;
  }
}

/**
 * The bubble landed: capture its geometry, clone it as the incoming content
 * layer, size the container once to the union of both boxes, hide the real
 * bubble, and start the timed flight. This is the flight's ONE deliberate
 * layout write on the flyer — every subsequent frame writes transform,
 * clip-path, and opacities only.
 */
function beginFlight(
  flight: ActiveSendMorph,
  bubble: HTMLElement,
  rect: DOMRect,
  now: number,
): void {
  const bubbleCs = window.getComputedStyle(bubble);
  const flyerCs = window.getComputedStyle(flight.flyer);
  const startRadius = Number.parseFloat(flyerCs.borderTopLeftRadius);
  flight.startRadius = Number.isFinite(startRadius) ? startRadius : 16;
  const targetRadius = Number.parseFloat(bubbleCs.borderTopLeftRadius);
  flight.targetRadius = Number.isFinite(targetRadius) ? targetRadius : flight.startRadius;

  // Clone before hiding, so the clone carries no inline flight styles.
  const incoming = bubble.cloneNode(true) as HTMLElement;
  prepareIncomingLayer(incoming, rect.width);
  flight.flyer.appendChild(incoming);
  flight.incoming = incoming;

  // One-time resize to the union box; the clip immediately re-reveals exactly
  // the composer-shaped region, so this write is invisible. The rect also seeds
  // the target cache that the sampled per-frame reads keep fresh.
  flight.unionWidth = Math.max(flight.startWidth, rect.width);
  flight.unionHeight = Math.max(flight.startHeight, rect.height);
  flight.flyer.style.width = `${flight.unionWidth}px`;
  flight.flyer.style.height = `${flight.unionHeight}px`;
  flight.targetLeft = rect.left;
  flight.targetTop = rect.top;
  flight.targetWidth = rect.width;
  flight.targetHeight = rect.height;
  applyBoxClip(flight, flight.startWidth, flight.startHeight, flight.startRadius);

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
 * One flight frame. Live-retargets: the bubble's *current* box refreshes a
 * cached target that the flyer eases toward, so a mid-flight shift (streaming
 * reply advancing the scroll) bends the flyer to the true landing spot. The
 * motion is a pure translation while the visible box morphs via clip-path —
 * nothing is ever scaled, so text stays sharp and images keep their aspect; and
 * nothing is ever laid out, since both content layers hold fixed pixel widths.
 * Inside the box, the composer-wrapped outgoing text fades through to the
 * bubble-layout incoming clone over the early leg.
 *
 * Per-frame cost discipline: the rect read — the loop's only layout read, and
 * its only chance to force a flush of layout dirtied elsewhere — runs on
 * alternate frames until the final leg, then every frame so touchdown is
 * pixel-exact. Every style write is rounded and deduplicated, so the settling
 * tail (sub-hundredth-pixel deltas) makes no DOM writes at all. Returns true
 * once the flight has retired.
 */
function stepFlight(flight: ActiveSendMorph, now: number): boolean {
  const bubble = flight.bubble;
  // A detached bubble (virtualization evicting the row mid-flight) has no
  // landing box anymore. Retire; the inline styles are cleared on the way out.
  if (!bubble || !bubble.isConnected) {
    retireSendMorph();
    return true;
  }

  const t = clamp01((now - flight.phaseStart) / SEND_MORPH_TRAVEL_MS);
  const e = easeOutQuint(t);

  if (flight.flightFrame % 2 === 0 || t >= SEND_MORPH_EXACT_RETARGET_FRACTION) {
    const b = bubble.getBoundingClientRect();
    // A connected bubble can still measure as a zero box for a frame (a
    // virtualized row being recycled, display toggling). A degenerate rect
    // never replaces the cached target — the flyer keeps steering toward the
    // last real box instead of diving at the viewport origin.
    if (b.width > 0 && b.height > 0) {
      flight.targetLeft = b.left;
      flight.targetTop = b.top;
      flight.targetWidth = b.width;
      flight.targetHeight = b.height;
      // If the live bubble outgrew the union captured at landing (an attachment
      // image finished decoding mid-flight), grow the container once more so
      // the clip can still reveal the full landing box. Rare, bounded write.
      if (b.width > flight.unionWidth) {
        flight.unionWidth = b.width;
        flight.flyer.style.width = `${b.width}px`;
      }
      if (b.height > flight.unionHeight) {
        flight.unionHeight = b.height;
        flight.flyer.style.height = `${b.height}px`;
      }
    }
  }
  flight.flightFrame += 1;

  const dx = round2((flight.targetLeft - flight.startLeft) * e);
  const dy = round2((flight.targetTop - flight.startTop) * e);
  const transform = `translate3d(${dx}px, ${dy}px, 0)`;
  if (transform !== flight.lastTransform) {
    flight.lastTransform = transform;
    flight.flyer.style.transform = transform;
  }

  // The container transform: the visible box eases from the composer's rect to
  // the bubble's live rect (size + corner radius), revealed by the clip.
  applyBoxClip(
    flight,
    flight.startWidth + (flight.targetWidth - flight.startWidth) * e,
    flight.startHeight + (flight.targetHeight - flight.startHeight) * e,
    flight.startRadius + (flight.targetRadius - flight.startRadius) * e,
  );

  // Content fade-through: outgoing out first, incoming in just behind it. Both
  // ramps live in the fastest leg of the ease, so the swap rides the motion.
  // Settled fades skip their writes — no style churn for the remaining flight.
  const outgoingOpacity = 1 - ramp(t, 0, SEND_MORPH_CONTENT_FADE_OUT_END);
  if (outgoingOpacity !== flight.lastOutgoingOpacity) {
    flight.lastOutgoingOpacity = outgoingOpacity;
    flight.outgoing.style.opacity = `${outgoingOpacity}`;
  }
  if (flight.incoming) {
    const incomingOpacity = ramp(
      t,
      SEND_MORPH_CONTENT_FADE_IN_START,
      SEND_MORPH_CONTENT_FADE_IN_END,
    );
    if (incomingOpacity !== flight.lastIncomingOpacity) {
      flight.lastIncomingOpacity = incomingOpacity;
      flight.incoming.style.opacity = `${incomingOpacity}`;
    }
  }

  // Crossfade over the final leg: flyer out, bubble in — the two become one.
  // The flyer's ramp finishes early (by SEND_MORPH_FLYER_FADE_END) while the
  // bubble's runs to t=1, so two full-strength copies never coexist.
  if (t >= SEND_MORPH_CROSSFADE_FRACTION) {
    const flyerOut = clamp01(
      (t - SEND_MORPH_CROSSFADE_FRACTION) /
        (SEND_MORPH_FLYER_FADE_END - SEND_MORPH_CROSSFADE_FRACTION),
    );
    const bubbleIn = clamp01(
      (t - SEND_MORPH_CROSSFADE_FRACTION) / (1 - SEND_MORPH_CROSSFADE_FRACTION),
    );
    flight.flyer.style.opacity = `${1 - flyerOut}`;
    bubble.style.opacity = `${bubbleIn}`;
  }

  if (t >= 1) {
    // Landed exactly on the bubble's current box; hand off to the real bubble.
    // Retire FIRST (that is what clears the bubble's inline opacity/animation),
    // then arm the glint on the now-clean node — the reverse order would have
    // the cleanup wipe the pulse the instant it was applied. This is the ONLY
    // call site: an interrupted retirement never lands, so it never glints.
    retireSendMorph();
    armLandingGlint(bubble);
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
