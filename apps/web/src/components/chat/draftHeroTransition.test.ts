import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  buildDraftHeroSwoopKeyframes,
  DRAFT_HERO_COMPOSER_ACCENT_KEYFRAMES,
  DRAFT_HERO_SEND_TO_DOCK_DELAY_MS,
  DRAFT_HERO_TRANSITION_ANIMATION_ID,
  DRAFT_HERO_TRANSITION_DURATION_MS,
  DRAFT_HERO_TRANSITION_EASING,
  resolveDraftHeroTransitionOffset,
  resolveDraftHeroSendToDockDelay,
  runMobileComposerTransition,
  waitForDraftHeroTransition,
} from "./draftHeroTransition";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("draft hero swoop motion", () => {
  it("lets the send launch lead the dock transition unless motion is reduced", () => {
    expect(resolveDraftHeroSendToDockDelay(false)).toBe(DRAFT_HERO_SEND_TO_DOCK_DELAY_MS);
    expect(resolveDraftHeroSendToDockDelay(true)).toBe(0);
  });

  it("derives the FLIP offset and ignores subpixel-only movement", () => {
    expect(
      resolveDraftHeroTransitionOffset({ left: 100, top: 240 }, { left: 100, top: 620 }),
    ).toEqual({ x: 0, y: -380 });
    expect(
      resolveDraftHeroTransitionOffset({ left: 100, top: 240 }, { left: 100.25, top: 240.25 }),
    ).toBeNull();
  });

  it("lands through a short deceleration segment with the product motion curve", () => {
    const keyframes = buildDraftHeroSwoopKeyframes({ x: 0, y: -400 });

    expect(keyframes).toEqual([
      {
        opacity: 0.98,
        transform: "translate3d(0px, -400px, 0)",
        offset: 0,
      },
      {
        opacity: 1,
        transform: "translate3d(0px, -40px, 0)",
        offset: 0.72,
      },
      {
        opacity: 1,
        transform: "translate3d(0, 0, 0)",
        offset: 1,
      },
    ]);
    expect(DRAFT_HERO_TRANSITION_DURATION_MS).toBeLessThanOrEqual(800);
    expect(DRAFT_HERO_TRANSITION_EASING).toBe("cubic-bezier(0.16, 1, 0.3, 1)");
  });

  it("reserves the brightest accent for the landing celebration", () => {
    expect(DRAFT_HERO_COMPOSER_ACCENT_KEYFRAMES[0]).toMatchObject({
      transform: "scale(1)",
      offset: 0,
    });
    expect(DRAFT_HERO_COMPOSER_ACCENT_KEYFRAMES[2]).toMatchObject({
      transform: "scale(1.006)",
      offset: 0.88,
    });
    expect(DRAFT_HERO_COMPOSER_ACCENT_KEYFRAMES[2]?.filter).toContain("brightness(1.09)");
    expect(DRAFT_HERO_COMPOSER_ACCENT_KEYFRAMES.at(-1)).toMatchObject({
      transform: "scale(1)",
      offset: 1,
    });
  });
});

describe("waitForDraftHeroTransition", () => {
  it("waits for active draft hero animations and ignores unrelated animations", async () => {
    let finishTransition: (() => void) | undefined;
    const transitionFinished = new Promise<void>((resolve) => {
      finishTransition = resolve;
    });
    vi.stubGlobal("document", {
      getAnimations: () => [
        { id: "unrelated-animation", finished: new Promise<void>(() => undefined) },
        { id: DRAFT_HERO_TRANSITION_ANIMATION_ID, finished: transitionFinished },
      ],
    });

    let handoffComplete = false;
    const handoff = waitForDraftHeroTransition().then(() => {
      handoffComplete = true;
    });
    await Promise.resolve();
    expect(handoffComplete).toBe(false);

    finishTransition?.();
    await handoff;
    expect(handoffComplete).toBe(true);
  });

  it("allows the handoff when an active transition is cancelled", async () => {
    vi.stubGlobal("document", {
      getAnimations: () => [
        {
          id: DRAFT_HERO_TRANSITION_ANIMATION_ID,
          finished: Promise.reject(new Error("cancelled")),
        },
      ],
    });

    await expect(waitForDraftHeroTransition()).resolves.toBeUndefined();
  });
});

describe("runMobileComposerTransition", () => {
  it("keeps the route handoff waiting while the mobile composer morph is active", async () => {
    let finishTransition: (() => void) | undefined;
    const transitionFinished = new Promise<void>((resolve) => {
      finishTransition = resolve;
    });
    const dataset: Record<string, string> = {};
    vi.stubGlobal("document", {
      documentElement: { dataset },
      getAnimations: () => [],
      startViewTransition: (update: () => void | Promise<void>) => {
        void update();
        return { finished: transitionFinished };
      },
    });
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({ matches: query === "(max-width: 639px)" }),
    });

    const transition = runMobileComposerTransition(() => undefined);
    await Promise.resolve();

    let handoffComplete = false;
    const handoff = waitForDraftHeroTransition().then(() => {
      handoffComplete = true;
    });
    await Promise.resolve();
    expect(handoffComplete).toBe(false);

    finishTransition?.();
    await Promise.all([transition, handoff]);
    expect(handoffComplete).toBe(true);
  });

  it("uses a scoped view transition on mobile", async () => {
    const dataset: Record<string, string> = {};
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => ({
      finished: Promise.resolve(update()).then(() => undefined),
    }));
    vi.stubGlobal("document", {
      documentElement: { dataset },
      startViewTransition,
    });
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({ matches: query === "(max-width: 639px)" }),
    });
    const update = vi.fn();

    await runMobileComposerTransition(update);

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(dataset).not.toHaveProperty("mobileComposerRouteTransition");
  });

  it("updates without a view transition when reduced motion is preferred", async () => {
    const startViewTransition = vi.fn();
    vi.stubGlobal("document", {
      documentElement: { dataset: {} },
      startViewTransition,
    });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: true }),
    });
    const update = vi.fn();

    await runMobileComposerTransition(update);

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });
});
