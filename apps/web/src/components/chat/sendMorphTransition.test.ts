// @vitest-environment happy-dom
//
// The send-morph motion is a hand-built container transform driven by a
// `requestAnimationFrame` loop. happy-dom has no real compositor, so these tests
// stub `requestAnimationFrame` (a manual queue that advances a timestamp) and
// assert the mechanism instead of pixels: the optimistic
// insertion/reconciliation (a pure function), the support/fallback gate, and
// the flight lifecycle — the outgoing layer is BUILT from the sent text (never
// a clone of the composer subtree), the landing poll, the bubble-clone incoming
// layer (which is how attachments fly), the clip-path box morph, the
// live-retargeted flight, the content fade-through, the final crossfade, and
// retirement on completion / second send / unmount / never-landing.
//
// The two brand touches are asserted the same way — as mechanism, not pixels:
// the charged-send wash is a class on the outgoing layer only (so it rides an
// existing fade and can never reach the bubble), and the landing glint is armed
// ONLY by a natural completion. The perf economies are asserted as behavior
// too: the landing rect is sampled on alternate frames (every frame over the
// final leg, so touchdown stays pixel-exact), a zero-sized measurement never
// replaces the cached target, and rounded, deduplicated style writes go silent
// over the settling tail.
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  canRunSendMorph,
  mergeOptimisticUserMessages,
  retireSendMorph,
  runSendMorphTransition,
} from "./sendMorphTransition";

interface Msg {
  id: string;
  text: string;
}

const server = (...ids: string[]): Msg[] => ids.map((id) => ({ id, text: `server:${id}` }));
const optimistic = (...ids: string[]): Msg[] => ids.map((id) => ({ id, text: `optimistic:${id}` }));

describe("mergeOptimisticUserMessages", () => {
  it("returns the server list unchanged (same reference) when nothing is pending", () => {
    const messages = server("a", "b");
    expect(mergeOptimisticUserMessages(messages, [])).toBe(messages);
  });

  it("appends an optimistic message that the server has not echoed yet", () => {
    const merged = mergeOptimisticUserMessages(server("a"), optimistic("pending"));
    expect(merged.map((m) => m.id)).toStrictEqual(["a", "pending"]);
    // The optimistic copy is the one shown until the echo lands.
    expect(merged[1]?.text).toBe("optimistic:pending");
  });

  it("drops the optimistic copy once the server echoes the same id — no duplicate, no flicker", () => {
    const serverMessages = server("a", "pending"); // echo arrived, keyed on the same id
    const merged = mergeOptimisticUserMessages(serverMessages, optimistic("pending"));
    // Exactly one bubble for `pending`, and it is the authoritative server copy.
    expect(merged).toBe(serverMessages);
    expect(merged.filter((m) => m.id === "pending")).toHaveLength(1);
    expect(merged.find((m) => m.id === "pending")?.text).toBe("server:pending");
  });

  it("keeps only the still-pending optimistic messages when a batch partially echoes", () => {
    const merged = mergeOptimisticUserMessages(
      server("a", "echoed"),
      optimistic("echoed", "pending"),
    );
    expect(merged.map((m) => m.id)).toStrictEqual(["a", "echoed", "pending"]);
    expect(merged.filter((m) => m.id === "echoed")).toHaveLength(1);
    expect(merged.find((m) => m.id === "echoed")?.text).toBe("server:echoed");
  });
});

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

function allowMotion(): void {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as MediaQueryList);
}

describe("canRunSendMorph", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is false without a surface", () => {
    allowMotion();
    expect(canRunSendMorph(null)).toBe(false);
  });

  it("is false under reduced motion even when everything else is available", () => {
    const surface = document.createElement("div");
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList);
    expect(canRunSendMorph(surface)).toBe(false);
  });

  it("is false when requestAnimationFrame is unavailable (SSR / headless)", () => {
    allowMotion();
    const surface = document.createElement("div");
    const original = window.requestAnimationFrame;
    // Force the loop driver away to simulate an environment that cannot animate.
    (window as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = undefined;
    expect(canRunSendMorph(surface)).toBe(false);
    window.requestAnimationFrame = original;
  });

  it("is true when rAF exists, motion is allowed, and a surface is present", () => {
    allowMotion();
    const surface = document.createElement("div");
    expect(canRunSendMorph(surface)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Flyer flight
// ---------------------------------------------------------------------------

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("runSendMorphTransition flyer flight", () => {
  let rafQueue: FrameRequestCallback[];
  let cancelSpy: ReturnType<typeof vi.fn>;

  // A composer surface whose text lives in the `[data-testid="composer-editor"]`
  // area, plus a send button — the exact subtree the OLD implementation cloned.
  // The rebuild must lift only the text, so the button/editor node must never
  // appear inside the flyer. Detached from the body so the only
  // `.conversation-send-flyer` in the body is the flyer itself.
  const makeSurface = (): { surface: HTMLElement; editor: HTMLElement } => {
    const surface = document.createElement("div");
    surface.className = "test-composer-surface";
    const editor = document.createElement("div");
    editor.setAttribute("data-testid", "composer-editor");
    editor.textContent = "the drafted message";
    surface.appendChild(editor);
    const button = document.createElement("button");
    button.setAttribute("data-testid", "composer-send-button");
    button.textContent = "Send";
    surface.appendChild(button);
    return { surface, editor };
  };

  // happy-dom measures every element as 0×0; the flight treats a zero box as a
  // degenerate frame (virtualization churn) and holds, so arriving bubbles get
  // a real default rect. Tests that care about geometry override it.
  const appendArrivingBubble = (messageId?: string): HTMLElement => {
    const bubble = document.createElement("div");
    bubble.className = "conversation-user-arrival";
    bubble.setAttribute("data-user-turn-arrival", "true");
    if (messageId) bubble.setAttribute("data-user-turn-arrival-id", messageId);
    bubble.textContent = "the drafted message";
    bubble.getBoundingClientRect = () => rect(600, 100, 240, 80);
    document.body.appendChild(bubble);
    return bubble;
  };

  const flyersInBody = (): HTMLElement[] => [
    ...document.body.querySelectorAll<HTMLElement>(".conversation-send-flyer"),
  ];

  // happy-dom has no animation engine, so the one-shot cleanup listener is
  // driven by hand. `animationName` is not settable on a plain Event, and it is
  // exactly what the handler filters on, so it is defined explicitly.
  const fireAnimationEnd = (target: HTMLElement, animationName: string): void => {
    const event = new Event("animationend", { bubbles: true });
    Object.defineProperty(event, "animationName", { value: animationName });
    target.dispatchEvent(event);
  };

  const flushFrame = (now = 0): void => {
    const cb = rafQueue.shift();
    if (cb) cb(now);
  };

  beforeEach(() => {
    allowMotion();

    rafQueue = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    cancelSpy = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancelSpy);
  });

  afterEach(() => {
    retireSendMorph();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("runs the commit directly (once) and mounts no flyer when rAF is unavailable", () => {
    const { surface } = makeSurface();
    const original = window.requestAnimationFrame;
    (window as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = undefined;
    const commit = vi.fn();

    runSendMorphTransition(surface, "the drafted message", commit);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(flyersInBody()).toHaveLength(0);
    window.requestAnimationFrame = original;
  });

  it("builds a fixed, inert flyer from the sent text — never a clone of the composer subtree", () => {
    const { surface } = makeSurface();
    const commit = vi.fn();

    runSendMorphTransition(surface, "the drafted message", commit);

    expect(commit).toHaveBeenCalledTimes(1);
    const flyers = flyersInBody();
    expect(flyers).toHaveLength(1);
    const flyer = flyers[0]!;
    expect(flyer).not.toBe(surface);
    expect(flyer.classList.contains("conversation-send-flyer")).toBe(true);
    expect(flyer.style.position).toBe("fixed");
    expect(flyer.getAttribute("aria-hidden")).toBe("true");
    expect(flyer.hasAttribute("inert")).toBe(true);
    expect(flyer.style.pointerEvents).toBe("none");
    // The flyer carries the sent text…
    expect(flyer.textContent).toContain("the drafted message");
    // …but is BUILT, not cloned: none of the composer subtree comes along.
    expect(flyer.querySelector('[data-testid="composer-send-button"]')).toBeNull();
    expect(flyer.querySelector('[data-testid="composer-editor"]')).toBeNull();
    expect(flyer.querySelector("button")).toBeNull();
    // The container holds exactly one layer before landing: the outgoing text.
    expect(flyer.children).toHaveLength(1);
    const outgoing = flyer.children[0] as HTMLElement;
    expect(outgoing.textContent).toBe("the drafted message");
    expect(outgoing.style.position).toBe("absolute");
  });

  it("strips the trailing conversation-references block from the flyer text", () => {
    const { surface } = makeSurface();
    const withRefs = [
      "keep this line",
      "",
      "<conversation_references>",
      '<conversation_reference index="1" source="user" message_id="m-1">',
      "```text",
      "quoted snippet",
      "```",
      "</conversation_reference>",
      "</conversation_references>",
    ].join("\n");

    runSendMorphTransition(surface, withRefs, () => {});

    const flyer = flyersInBody()[0]!;
    expect(flyer.textContent).toBe("keep this line");
    expect(flyer.textContent).not.toContain("conversation_references");
    expect(flyer.textContent).not.toContain("quoted snippet");
  });

  it("lands on the arriving bubble, hides it, and flies the flyer toward its box", () => {
    const { surface } = makeSurface();
    const bubble = appendArrivingBubble();

    runSendMorphTransition(surface, "the drafted message", () => {});
    const flyer = flyersInBody()[0]!;
    // Nothing has moved yet: the seeking poll has not run.
    expect(flyer.style.transform).toBe("translate3d(0, 0, 0)");

    flushFrame(0); // the landing poll finds the bubble on the first frame → flight begins

    // The real bubble is hidden with its CSS arrival suppressed until the crossfade.
    expect(bubble.style.opacity).toBe("0");
    expect(bubble.style.animation).toBe("none");
    expect(bubble.style.willChange).toBe("opacity");

    // The first flight frame writes a composited transform — translate only.
    // Scale was deliberately removed: independent x/y factors squished and
    // blurred the text (and badly warped tall attachment bubbles).
    flushFrame(350); // t = 350/700 = 0.5
    expect(flyer.style.transform).toContain("translate3d");
    expect(flyer.style.transform).not.toContain("scale");
    // Before the final leg the bubble is still fully hidden (no crossfade yet).
    expect(bubble.style.opacity).toBe("0");
  });

  it("morphs the visible box from the composer's rect to the bubble's rect via clip-path — no scale, no reflow", () => {
    const { surface, editor } = makeSurface();
    editor.getBoundingClientRect = () => rect(0, 500, 400, 100);
    const bubble = appendArrivingBubble();
    bubble.getBoundingClientRect = () => rect(600, 100, 240, 80);

    runSendMorphTransition(surface, "the drafted message", () => {});
    const flyer = flyersInBody()[0]!;

    flushFrame(0); // landing poll finds the bubble → union resize + flight

    // The container is sized ONCE to the union of both boxes (400×100 vs
    // 240×80) and the clip immediately re-reveals the composer-shaped region.
    expect(flyer.style.width).toBe("400px");
    expect(flyer.style.height).toBe("100px");
    expect(flyer.style.clipPath).toBe("inset(0px 0px 0px 0px round 16px)");

    // Mid-flight the clip is somewhere between the two shapes…
    flushFrame(350);
    expect(flyer.style.transform).toContain("translate3d");
    expect(flyer.style.transform).not.toContain("scale");
    expect(flyer.style.clipPath).toContain("round");

    // …and at t=1 the visible box IS the bubble's box: 240×80 revealed out of
    // the 400×100 union → insets of 160px (right) and 20px (bottom). The clip
    // is written before the flight retires, so the detached flyer still holds
    // the landing value.
    flushFrame(700);
    expect(flyer.style.clipPath).toBe("inset(0px 160px 20px 0px round 16px)");
  });

  it("clones the arriving bubble as the incoming layer — attachments fly with the box", () => {
    const { surface } = makeSurface();
    const bubble = appendArrivingBubble();
    bubble.setAttribute("data-message-id", "m-1");
    const img = document.createElement("img");
    img.src = "blob:preview-1";
    bubble.appendChild(img);
    bubble.getBoundingClientRect = () => rect(600, 100, 240, 80);

    runSendMorphTransition(surface, "the drafted message", () => {});
    const flyer = flyersInBody()[0]!;

    flushFrame(0); // begin flight → the bubble is cloned into the flyer

    const incoming = flyer.children[1] as HTMLElement;
    expect(incoming).toBeDefined();
    // The clone carries the bubble's content — including the attachment image.
    expect(incoming.querySelector("img")?.getAttribute("src")).toBe("blob:preview-1");
    // …but never the landing hook, arrival class, or message identity: it can
    // never be found by the seek poll or mistaken for a real timeline row.
    expect(incoming.hasAttribute("data-user-turn-arrival")).toBe(false);
    expect(incoming.classList.contains("conversation-user-arrival")).toBe(false);
    expect(incoming.hasAttribute("data-message-id")).toBe(false);
    // Pinned at the bubble's own pixel width so it lays out exactly once.
    expect(incoming.style.position).toBe("absolute");
    expect(incoming.style.width).toBe("240px");
    // Hidden at landing detection; it fades in over the early leg.
    expect(incoming.style.opacity).toBe("0");
    // The real bubble (still carrying the hook) was hidden, not the clone.
    expect(bubble.style.opacity).toBe("0");
  });

  it("fades the content through: composer-wrapped text out first, bubble-layout clone in behind it", () => {
    const { surface } = makeSurface();
    appendArrivingBubble();

    runSendMorphTransition(surface, "the drafted message", () => {});
    const flyer = flyersInBody()[0]!;
    flushFrame(0); // begin flight (phaseStart = 0)
    const outgoing = flyer.children[0] as HTMLElement;
    const incoming = flyer.children[1] as HTMLElement;

    // t = 0.09: outgoing is half out (ramp 0→0.18); incoming has not started.
    flushFrame(63);
    expect(Number(outgoing.style.opacity)).toBeCloseTo(0.5, 5);
    expect(Number(incoming.style.opacity)).toBe(0);

    // t = 0.25: outgoing fully out; incoming halfway in (ramp 0.12→0.38).
    flushFrame(175);
    expect(Number(outgoing.style.opacity)).toBe(0);
    expect(Number(incoming.style.opacity)).toBeCloseTo(0.5, 5);

    // t = 0.5: the incoming layer — the bubble's exact render — is fully in.
    flushFrame(350);
    expect(Number(incoming.style.opacity)).toBe(1);
  });

  it("binds the landing to the sent message id — a stale arrival hook is never adopted", () => {
    const { surface } = makeSurface();
    // Two rows still inside the arrival TTL: an earlier send (first in DOM
    // order) and the one this flight belongs to.
    const staleBubble = appendArrivingBubble("m-old");
    const ownBubble = appendArrivingBubble("m-new");

    runSendMorphTransition(surface, "the drafted message", () => {}, "m-new");
    flushFrame(0);

    // The flight landed on ITS bubble, not the first hook in the document.
    expect(ownBubble.style.opacity).toBe("0");
    expect(staleBubble.style.opacity).toBe("");
  });

  it("keeps seeking (then dissolves) when only OTHER turns' hooks exist for its id", () => {
    const { surface } = makeSurface();
    const otherBubble = appendArrivingBubble("m-old");

    runSendMorphTransition(surface, "the drafted message", () => {}, "m-new");
    for (let i = 0; i < 10; i += 1) flushFrame(0); // exhaust the poll → fallback

    // The other turn's bubble was never touched; this flight dissolves in place.
    expect(otherBubble.style.opacity).toBe("");
    const flyer = flyersInBody()[0]!;
    flushFrame(180); // fallback fade completes → retire
    expect(flyer.isConnected).toBe(false);
  });

  it("retires a live flight even when the next send cannot fly (fallback gate)", () => {
    const { surface } = makeSurface();
    runSendMorphTransition(surface, "first message", () => {});
    expect(flyersInBody()).toHaveLength(1);

    // Second send with no surface: falls back to a plain commit — but the
    // previous flyer must not be left hanging over the composer.
    const commit = vi.fn();
    runSendMorphTransition(null, "second message", commit);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(flyersInBody()).toHaveLength(0);
  });

  it("never strands the flyer when the commit throws", () => {
    const { surface } = makeSurface();

    expect(() =>
      runSendMorphTransition(surface, "the drafted message", () => {
        throw new Error("commit failed");
      }),
    ).toThrow("commit failed");

    expect(flyersInBody()).toHaveLength(0);
  });

  it("keeps steering toward the last real box when the bubble measures 0×0 mid-flight", () => {
    const { surface, editor } = makeSurface();
    editor.getBoundingClientRect = () => rect(0, 500, 400, 100);
    const bubble = appendArrivingBubble();
    let bubbleBox = rect(600, 100, 240, 80);
    bubble.getBoundingClientRect = () => bubbleBox;

    runSendMorphTransition(surface, "the drafted message", () => {});
    const flyer = flyersInBody()[0]!;
    flushFrame(0); // begin flight
    flushFrame(350);
    expect(flyer.style.transform).toContain("translate3d");

    // A virtualized row being recycled measures 0×0 for a frame. The degenerate
    // rect must never replace the cached target: the flyer keeps easing toward
    // the last real box instead of diving at the viewport origin.
    bubbleBox = rect(0, 0, 0, 0);
    flushFrame(490); // t = 0.7 — a measuring frame; the zero box is rejected
    expect(flyer.style.transform).not.toContain("translate3d(0px, 0px");
    expect(flyer.isConnected).toBe(true);

    // The box comes back → the flight completes and lands on it exactly.
    bubbleBox = rect(600, 100, 240, 80);
    flushFrame(700);
    expect(flyersInBody()).toHaveLength(0);
  });

  it("grows the union box when the bubble outgrows it mid-flight (image decode)", () => {
    const { surface, editor } = makeSurface();
    editor.getBoundingClientRect = () => rect(0, 500, 400, 100);
    const bubble = appendArrivingBubble();
    let bubbleBox = rect(600, 300, 240, 80);
    bubble.getBoundingClientRect = () => bubbleBox;

    runSendMorphTransition(surface, "the drafted message", () => {});
    const flyer = flyersInBody()[0]!;
    flushFrame(0); // union = 400×100
    expect(flyer.style.height).toBe("100px");

    // An attachment finishes decoding and the bubble grows taller than the
    // captured union — the container grows once so the clip can reveal it.
    bubbleBox = rect(600, 300, 240, 320);
    flushFrame(350);
    expect(flyer.style.height).toBe("320px");
  });

  it("crossfades only over the final leg, flyer fading out ahead of the bubble fading in", () => {
    const { surface } = makeSurface();
    const bubble = appendArrivingBubble();

    runSendMorphTransition(surface, "the drafted message", () => {});
    const flyer = flyersInBody()[0]!;
    flushFrame(0); // begin flight (phaseStart = 0)

    // Well past the old 0.6 fraction but before the new 0.85: no crossfade yet.
    flushFrame(560); // t = 0.8
    expect(flyer.style.opacity).toBe("");
    expect(bubble.style.opacity).toBe("0");

    // t = 0.9: flyer ramp (0.85→0.95) is at 0.5; bubble ramp (0.85→1.0) is at ⅓.
    // The flyer leads — the sum stays under full double exposure.
    flushFrame(630);
    expect(Number(flyer.style.opacity)).toBeCloseTo(0.5, 5);
    expect(Number(bubble.style.opacity)).toBeCloseTo(1 / 3, 5);

    // t = 0.96: the flyer is fully out while the bubble is still finishing in —
    // two full-strength copies never coexist.
    flushFrame(672);
    expect(Number(flyer.style.opacity)).toBe(0);
    expect(Number(bubble.style.opacity)).toBeLessThan(1);
  });

  it("live-retargets: at landing the flyer sits on the bubble's CURRENT box, not a stale one", () => {
    const { surface, editor } = makeSurface();
    // A fixed start box (the editor text area).
    editor.getBoundingClientRect = () => rect(0, 500, 400, 100);
    const bubble = appendArrivingBubble();
    // The bubble starts here, then the streaming reply advances the scroll and it
    // moves up before the flight finishes.
    let bubbleBox = rect(0, 100, 200, 50);
    bubble.getBoundingClientRect = () => bubbleBox;

    runSendMorphTransition(surface, "the drafted message", () => {});
    const flyer = flyersInBody()[0]!;
    flushFrame(0); // begin flight

    flushFrame(350); // mid-flight, bubble still at top 100
    // The bubble moves up (mid-flight timeline shift).
    bubbleBox = rect(0, 60, 200, 50);
    flushFrame(700); // t = 1 → land exactly on the current box

    // dy at t=1 is (currentTop - startTop) = 60 - 500 = -440, NOT the stale -400.
    expect(flyer.style.transform).toContain("translate3d(0px, -440px, 0)");
  });

  it("retires the flyer and restores the bubble when the flight completes", () => {
    const { surface } = makeSurface();
    const bubble = appendArrivingBubble();

    runSendMorphTransition(surface, "the drafted message", () => {});
    flushFrame(0); // begin flight
    expect(flyersInBody()).toHaveLength(1);

    flushFrame(700); // t = 1 → land + retire

    expect(flyersInBody()).toHaveLength(0);
    // Bubble inline styles are cleared so it settles as an ordinary message.
    expect(bubble.style.opacity).toBe("");
    expect(bubble.style.animation).toBe("");
    expect(bubble.style.willChange).toBe("");
  });

  it("dissolves the flyer in place when the bubble never lands (never strands it)", () => {
    const { surface } = makeSurface();
    const commit = vi.fn(); // never appends a bubble

    runSendMorphTransition(surface, "the drafted message", commit);
    const flyer = flyersInBody()[0]!;
    expect(flyersInBody()).toHaveLength(1);

    // Exhaust the landing poll cap (10 frames) without a bubble appearing; the
    // 10th frame switches to the in-place fallback fade (phaseStart = 0).
    for (let i = 0; i < 10; i += 1) flushFrame(0);

    flushFrame(90); // fallback t = 90/180 = 0.5
    expect(flyer.style.opacity).toBe("0.5");
    // The bubble was never appended, so nothing was ever hidden.

    flushFrame(180); // fallback t = 1 → retire
    expect(flyersInBody()).toHaveLength(0);
  });

  it("retires the previous flight when a second send starts", () => {
    const { surface } = makeSurface();

    runSendMorphTransition(surface, "the drafted message", () => {});
    const first = flyersInBody()[0]!;

    runSendMorphTransition(surface, "the drafted message", () => {});
    const flyers = flyersInBody();

    // Only the newest flyer remains; the previous one was retired instantly.
    expect(flyers).toHaveLength(1);
    expect(flyers[0]).not.toBe(first);
    expect(first.isConnected).toBe(false);
  });

  it("retireSendMorph removes an airborne flyer and clears the bubble styles (unmount / thread switch)", () => {
    const { surface } = makeSurface();
    const bubble = appendArrivingBubble();

    runSendMorphTransition(surface, "the drafted message", () => {});
    flushFrame(0); // begin flight
    expect(flyersInBody()).toHaveLength(1);
    expect(bubble.style.opacity).toBe("0");

    retireSendMorph();

    expect(flyersInBody()).toHaveLength(0);
    expect(bubble.style.opacity).toBe("");
    expect(bubble.style.animation).toBe("");
    // The pending rAF was cancelled on retire.
    expect(cancelSpy).toHaveBeenCalled();
  });

  it("is inert when retireSendMorph is called with no flight in the air", () => {
    expect(() => retireSendMorph()).not.toThrow();
    expect(flyersInBody()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Charged-send wash — a static look on the outgoing layer, riding its fade
  // -------------------------------------------------------------------------

  it("puts the charged-send wash on the outgoing layer only — never the clone or the bubble", () => {
    const { surface } = makeSurface();
    const bubble = appendArrivingBubble();

    runSendMorphTransition(surface, "the drafted message", () => {});
    const flyer = flyersInBody()[0]!;
    const outgoing = flyer.children[0] as HTMLElement;
    // The wash rides the outgoing layer's existing 0→0.18 opacity ramp, so it
    // costs no per-frame write and is spent ~125ms in.
    expect(outgoing.classList.contains("conversation-send-flyer-charge")).toBe(true);
    expect(flyer.classList.contains("conversation-send-flyer-charge")).toBe(false);

    flushFrame(0); // land → the bubble clone is appended as the incoming layer
    const incoming = flyer.children[1] as HTMLElement;
    // The clone must stay pixel-identical to the real bubble: no tint.
    expect(incoming.classList.contains("conversation-send-flyer-charge")).toBe(false);

    flushFrame(700); // land + retire
    expect(bubble.classList.contains("conversation-send-flyer-charge")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Landing glint — armed by a natural completion, and by nothing else
  // -------------------------------------------------------------------------

  it("glints the real bubble when the flight completes naturally, after the inline cleanup", () => {
    const { surface } = makeSurface();
    const bubble = appendArrivingBubble();

    runSendMorphTransition(surface, "the drafted message", () => {});
    flushFrame(0); // begin flight
    expect(bubble.classList.contains("conversation-user-landing-glint")).toBe(false);

    flushFrame(700); // t = 1 → land + retire + glint

    expect(bubble.classList.contains("conversation-user-landing-glint")).toBe(true);
    // Armed AFTER retirement, so the cleanup that clears inline opacity and
    // animation cannot wipe the pulse it just applied.
    expect(bubble.style.opacity).toBe("");
    expect(bubble.style.animation).toBe("");
  });

  it("clears the glint on its own animationend — and not on a descendant's", () => {
    const { surface } = makeSurface();
    const bubble = appendArrivingBubble();
    const child = document.createElement("span");
    bubble.appendChild(child);

    runSendMorphTransition(surface, "the drafted message", () => {});
    flushFrame(0);
    flushFrame(700);
    expect(bubble.classList.contains("conversation-user-landing-glint")).toBe(true);

    // A descendant's animation ending bubbles to the same listener; it must not
    // strip the glint mid-pulse.
    fireAnimationEnd(child, "conversation-user-arrival");
    expect(bubble.classList.contains("conversation-user-landing-glint")).toBe(true);

    fireAnimationEnd(bubble, "conversation-user-landing-glint");
    expect(bubble.classList.contains("conversation-user-landing-glint")).toBe(false);
  });

  it("does not glint on an interrupted retirement (thread switch / unmount / second send)", () => {
    const { surface } = makeSurface();
    const bubble = appendArrivingBubble();

    runSendMorphTransition(surface, "the drafted message", () => {});
    flushFrame(0); // begin flight
    flushFrame(350); // mid-flight

    retireSendMorph(); // the flight never landed — nothing to celebrate

    expect(bubble.classList.contains("conversation-user-landing-glint")).toBe(false);
  });

  it("does not glint on the fallback dissolve (the bubble never landed)", () => {
    const { surface } = makeSurface();

    runSendMorphTransition(surface, "the drafted message", () => {});
    for (let i = 0; i < 10; i += 1) flushFrame(0); // exhaust the poll → fallback
    flushFrame(180); // dissolve completes → retire

    // A bubble arriving late is a plain arrival: it was never flown to.
    const bubble = appendArrivingBubble();
    expect(bubble.classList.contains("conversation-user-landing-glint")).toBe(false);
    expect(document.querySelectorAll(".conversation-user-landing-glint")).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Per-frame economies — sampled rect reads, deduplicated writes
  // -------------------------------------------------------------------------

  it("samples the landing rect on alternate frames early, every frame over the final leg", () => {
    const { surface, editor } = makeSurface();
    editor.getBoundingClientRect = () => rect(0, 500, 400, 100);
    const bubble = appendArrivingBubble();
    let reads = 0;
    bubble.getBoundingClientRect = () => {
      reads += 1;
      return rect(600, 100, 240, 80);
    };

    runSendMorphTransition(surface, "the drafted message", () => {});
    flushFrame(0); // begin flight (one seek read + one landing read)
    const afterLanding = reads;

    // Early travel: flight frames 0..3 → only the even ones (0, 2) read.
    flushFrame(70); // frame 0 — reads
    flushFrame(140); // frame 1 — skips
    flushFrame(210); // frame 2 — reads
    flushFrame(280); // frame 3 — skips
    expect(reads - afterLanding).toBe(2);

    // Final leg (t >= 0.7): every frame reads, so touchdown is pixel-exact.
    const beforeFinalLeg = reads;
    flushFrame(560); // frame 4, t = 0.8 — reads (even AND final leg)
    flushFrame(630); // frame 5, t = 0.9 — reads (final leg overrides parity)
    expect(reads - beforeFinalLeg).toBe(2);
  });

  it("stops writing transform and clip once the settling tail rounds to the same values", () => {
    const { surface, editor } = makeSurface();
    editor.getBoundingClientRect = () => rect(0, 500, 400, 100);
    appendArrivingBubble();

    runSendMorphTransition(surface, "the drafted message", () => {});
    const flyer = flyersInBody()[0]!;
    flushFrame(0); // begin flight

    // Deep in the settling tail the eased deltas are far below 0.01px per
    // frame; rounding makes consecutive frames serialize identically, and the
    // dedup then skips the DOM write entirely.
    flushFrame(690); // t ≈ 0.986
    const tailTransform = flyer.style.transform;
    const tailClip = flyer.style.clipPath;
    flushFrame(693);
    flushFrame(696);
    expect(flyer.style.transform).toBe(tailTransform);
    expect(flyer.style.clipPath).toBe(tailClip);
  });
});
