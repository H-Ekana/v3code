// @vitest-environment happy-dom
//
// The send-morph motion is a hand-built flyer driven by a `requestAnimationFrame`
// loop. happy-dom has no real compositor, so these tests stub
// `requestAnimationFrame` (a manual queue that advances a timestamp) and assert
// the mechanism instead of pixels: the optimistic insertion/reconciliation (a
// pure function), the support/fallback gate, and the flight lifecycle — the
// flyer is BUILT from the sent text (never a subtree clone), the landing poll,
// the live-retargeted flight, the crossfade, and retirement on completion /
// second send / unmount / never-landing.
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

  const appendArrivingBubble = (): HTMLElement => {
    const bubble = document.createElement("div");
    bubble.className = "conversation-user-arrival";
    bubble.setAttribute("data-user-turn-arrival", "true");
    bubble.textContent = "the drafted message";
    document.body.appendChild(bubble);
    return bubble;
  };

  const flyersInBody = (): HTMLElement[] => [
    ...document.body.querySelectorAll<HTMLElement>(".conversation-send-flyer"),
  ];

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
    // One element carrying a single text node — tens of nodes at most.
    expect(flyer.children).toHaveLength(0);
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

    // The first flight frame writes a composited transform (translate3d + scale).
    flushFrame(350); // t = 350/700 = 0.5
    expect(flyer.style.transform).toContain("translate3d");
    expect(flyer.style.transform).toContain("scale");
    // Before the final leg the bubble is still fully hidden (no crossfade yet).
    expect(bubble.style.opacity).toBe("0");
  });

  it("crossfades the flyer out and the bubble in over the final leg", () => {
    const { surface } = makeSurface();
    const bubble = appendArrivingBubble();

    runSendMorphTransition(surface, "the drafted message", () => {});
    const flyer = flyersInBody()[0]!;
    flushFrame(0); // begin flight (phaseStart = 0)

    flushFrame(630); // t = 0.9 → crossfade fraction (0.9 - 0.6) / 0.4 = 0.75
    expect(Number(flyer.style.opacity)).toBeCloseTo(0.25, 5);
    expect(Number(bubble.style.opacity)).toBeCloseTo(0.75, 5);
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
});
