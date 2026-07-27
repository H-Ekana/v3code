export const DRAFT_HERO_TRANSITION_ANIMATION_ID = "t3-draft-hero-transition";
export const DRAFT_HERO_TRANSITION_DURATION_MS = 560;
export const DRAFT_HERO_TRANSITION_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
export const DRAFT_HERO_SEND_TO_DOCK_DELAY_MS = 240;
export const MOBILE_COMPOSER_VIEW_TRANSITION_NAME = "t3-mobile-composer";
export const MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME = "t3-mobile-draft-headline";

export interface DraftHeroTransitionOffset {
  readonly x: number;
  readonly y: number;
}

export function resolveDraftHeroSendToDockDelay(prefersReducedMotion: boolean): number {
  return prefersReducedMotion ? 0 : DRAFT_HERO_SEND_TO_DOCK_DELAY_MS;
}

export function resolveDraftHeroTransitionOffset(
  previousRect: Pick<DOMRect, "left" | "top">,
  nextRect: Pick<DOMRect, "left" | "top">,
): DraftHeroTransitionOffset | null {
  const offset = {
    x: previousRect.left - nextRect.left,
    y: previousRect.top - nextRect.top,
  };
  return Math.abs(offset.x) >= 0.5 || Math.abs(offset.y) >= 0.5 ? offset : null;
}

export function buildDraftHeroSwoopKeyframes({ x, y }: DraftHeroTransitionOffset): Keyframe[] {
  return [
    {
      opacity: 0.98,
      transform: `translate3d(${x}px, ${y}px, 0)`,
      offset: 0,
    },
    {
      opacity: 1,
      transform: `translate3d(${x * 0.06}px, ${y * 0.1}px, 0)`,
      offset: 0.72,
    },
    {
      opacity: 1,
      transform: "translate3d(0, 0, 0)",
      offset: 1,
    },
  ];
}

export const DRAFT_HERO_COMPOSER_ACCENT_KEYFRAMES: Keyframe[] = [
  {
    filter: "brightness(1) saturate(1) drop-shadow(0 0 0 transparent)",
    transform: "scale(1)",
    offset: 0,
  },
  {
    filter:
      "brightness(1.02) saturate(1.04) drop-shadow(0 0 2px color-mix(in srgb, var(--primary) 14%, transparent))",
    transform: "scale(0.996)",
    offset: 0.68,
  },
  {
    filter:
      "brightness(1.09) saturate(1.14) drop-shadow(0 0 7px color-mix(in srgb, var(--primary) 36%, transparent))",
    transform: "scale(1.006)",
    offset: 0.88,
  },
  {
    filter: "brightness(1) saturate(1) drop-shadow(0 0 0 transparent)",
    transform: "scale(1)",
    offset: 1,
  },
];

type ComposerViewTransition = {
  readonly finished: Promise<void>;
};

let activeMobileComposerTransition: Promise<void> | null = null;

type ComposerViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ComposerViewTransition;
};

export async function waitForDraftHeroTransition(): Promise<void> {
  const mobileComposerTransition = activeMobileComposerTransition;
  if (typeof document === "undefined" || typeof document.getAnimations !== "function") {
    await mobileComposerTransition;
    return;
  }

  const activeTransitions = document
    .getAnimations()
    .filter((animation) => animation.id === DRAFT_HERO_TRANSITION_ANIMATION_ID);

  await Promise.all([
    mobileComposerTransition,
    ...activeTransitions.map(async (animation) => {
      try {
        await animation.finished;
      } catch {
        // A cancelled transition is already safe to hand off.
      }
    }),
  ]);
}

export async function runMobileComposerTransition(
  update: () => void | Promise<void>,
): Promise<void> {
  if (typeof document === "undefined" || typeof window === "undefined") {
    await update();
    return;
  }

  const transitionDocument = document as ComposerViewTransitionDocument;
  const mobileViewport = window.matchMedia?.("(max-width: 639px)").matches ?? false;
  const prefersReducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (!mobileViewport || prefersReducedMotion || !transitionDocument.startViewTransition) {
    await update();
    return;
  }

  let updateStarted = false;
  const runUpdate = async () => {
    if (updateStarted) return;
    updateStarted = true;
    await update();
  };
  let transitionFinished: Promise<void> | null = null;
  transitionDocument.documentElement.dataset.mobileComposerRouteTransition = "true";
  try {
    const transition = transitionDocument.startViewTransition(runUpdate);
    transitionFinished = transition.finished.catch(() => undefined);
    activeMobileComposerTransition = transitionFinished;
    try {
      await transition.finished;
    } catch {
      await runUpdate();
    }
  } catch {
    await runUpdate();
  } finally {
    if (activeMobileComposerTransition === transitionFinished) {
      activeMobileComposerTransition = null;
    }
    delete transitionDocument.documentElement.dataset.mobileComposerRouteTransition;
  }
}
