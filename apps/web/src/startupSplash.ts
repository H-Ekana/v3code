export const STARTUP_SPLASH_HOLD_MS = 3_000;
export const STARTUP_SPLASH_EXIT_MS = 820;
export const STARTUP_SPLASH_REDUCED_EXIT_MS = 180;

type Rect = Pick<DOMRect, "height" | "left" | "top" | "width">;
type StartupSplashGate = {
  readonly markAppReady: () => void;
};
type CreateStartupSplashGateOptions = {
  readonly onExit: () => void;
  readonly schedule?: (callback: () => void, delayMs: number) => number;
};

let activeStartupSplashGate: StartupSplashGate | null = null;
let appReadyBeforeControllerStart = false;

export function createStartupSplashGate({
  onExit,
  schedule = (callback, delayMs) => window.setTimeout(callback, delayMs),
}: CreateStartupSplashGateOptions): StartupSplashGate {
  let appReady = false;
  let holdElapsed = false;
  let exitStarted = false;

  const tryExit = () => {
    if (exitStarted || !appReady || !holdElapsed) {
      return;
    }
    exitStarted = true;
    onExit();
  };

  schedule(() => {
    holdElapsed = true;
    tryExit();
  }, STARTUP_SPLASH_HOLD_MS);

  return {
    markAppReady: () => {
      appReady = true;
      tryExit();
    },
  };
}

export function markStartupSplashAppReady(): void {
  appReadyBeforeControllerStart = true;
  activeStartupSplashGate?.markAppReady();
}

export function buildStartupLogoFlightKeyframes(source: Rect, target: Rect): Keyframe[] {
  const sourceCenterX = source.left + source.width / 2;
  const sourceCenterY = source.top + source.height / 2;
  const targetCenterX = target.left + target.width / 2;
  const targetCenterY = target.top + target.height / 2;
  const deltaX = targetCenterX - sourceCenterX;
  const deltaY = targetCenterY - sourceCenterY;
  const targetScale = Math.min(target.width / source.width, target.height / source.height);

  return [
    {
      offset: 0,
      opacity: 1,
      filter: "brightness(1) drop-shadow(0 9px 22px rgb(65 32 92 / 24%))",
      transform: "translate3d(0, 0, 0) scale(1)",
    },
    {
      offset: 0.24,
      opacity: 1,
      filter: "brightness(1.14) drop-shadow(0 0 22px rgb(190 105 255 / 48%))",
      transform: `translate3d(${deltaX * 0.18}px, ${deltaY * 0.14 - 22}px, 0) scale(0.94)`,
    },
    {
      offset: 0.7,
      opacity: 1,
      filter: "brightness(1.06) drop-shadow(0 0 14px rgb(169 89 235 / 34%))",
      transform: `translate3d(${deltaX * 0.72}px, ${deltaY * 0.66 - 14}px, 0) scale(${0.58 + targetScale * 0.42})`,
    },
    {
      offset: 1,
      opacity: 1,
      filter: "brightness(1) drop-shadow(0 0 5px rgb(148 82 211 / 24%))",
      transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${targetScale})`,
    },
  ];
}

export function resolveStartupSplashExitDuration(prefersReducedMotion: boolean): number {
  return prefersReducedMotion ? STARTUP_SPLASH_REDUCED_EXIT_MS : STARTUP_SPLASH_EXIT_MS;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function animateElement(
  element: Element | null,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
    return null;
  }
  if (typeof element.animate !== "function") {
    return null;
  }
  try {
    return element.animate(keyframes, options);
  } catch {
    return null;
  }
}

function getCloudExitTransform(cloud: HTMLElement): string {
  const horizontalDrift = cloud.classList.contains("v3-splash-clouds-foreground-left")
    ? "-5vw"
    : cloud.classList.contains("v3-splash-clouds-foreground-right")
      ? "5vw"
      : cloud.classList.contains("v3-splash-clouds-mid")
        ? "-2vw"
        : "0";
  const verticalDrift = cloud.classList.contains("v3-splash-clouds-mid") ? "25vh" : "39vh";
  return `translate3d(${horizontalDrift}, ${verticalDrift}, 0) scale(1.07)`;
}

function releaseApp(root: HTMLElement, splash: HTMLElement, logoTarget: HTMLElement | null): void {
  logoTarget?.style.removeProperty("visibility");
  logoTarget?.style.removeProperty("opacity");
  root.inert = false;
  root.removeAttribute("aria-hidden");
  splash.remove();
  document.documentElement.dataset.startupSplash = "complete";
  activeStartupSplashGate = null;
}

async function runStartupSplashExit(root: HTMLElement, splash: HTMLElement): Promise<void> {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const exitDuration = resolveStartupSplashExitDuration(prefersReducedMotion);
  const splashLogo = splash.querySelector<HTMLElement>(".v3-splash-logo");
  const logoTarget = document.querySelector<HTMLElement>("[data-startup-logo-target]");
  const sourceRect = splashLogo?.getBoundingClientRect() ?? null;
  const targetRect = logoTarget?.getBoundingClientRect() ?? null;

  if (logoTarget && sourceRect && targetRect && !prefersReducedMotion) {
    logoTarget.style.opacity = "0";
  }

  document.documentElement.dataset.startupSplash = "exiting";

  animateElement(
    splash,
    prefersReducedMotion
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { offset: 0, opacity: 1 },
          { offset: 0.78, opacity: 1 },
          { offset: 1, opacity: 0 },
        ],
    {
      duration: exitDuration,
      easing: prefersReducedMotion ? "linear" : "cubic-bezier(0.16, 1, 0.3, 1)",
      fill: "forwards",
    },
  );

  if (!prefersReducedMotion) {
    if (splashLogo && sourceRect && targetRect) {
      animateElement(splashLogo, buildStartupLogoFlightKeyframes(sourceRect, targetRect), {
        delay: 70,
        duration: 590,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "forwards",
      });
    } else {
      animateElement(
        splashLogo,
        [
          { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
          { opacity: 0, transform: "translate3d(0, -24px, 0) scale(0.72)" },
        ],
        {
          duration: 520,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          fill: "forwards",
        },
      );
    }

    animateElement(logoTarget, [{ opacity: 0 }, { opacity: 1 }], {
      delay: 640,
      duration: 180,
      easing: "linear",
      fill: "forwards",
    });

    const clouds = splash.querySelectorAll<HTMLElement>(".v3-splash-cloud-layer");
    clouds.forEach((cloud, index) => {
      const cloudStyle = window.getComputedStyle(cloud);
      animateElement(
        cloud,
        [
          { opacity: cloudStyle.opacity, transform: cloudStyle.transform },
          { opacity: 0, transform: getCloudExitTransform(cloud) },
        ],
        {
          delay: 60 + index * 35,
          duration: 680 + index * 28,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          fill: "forwards",
        },
      );
    });

    const stars = splash.querySelector<HTMLElement>(".v3-splash-stars");
    animateElement(
      stars,
      [
        { opacity: window.getComputedStyle(stars ?? splash).opacity, transform: "scale(1)" },
        { opacity: 0, transform: "translate3d(-1.2vw, -0.8vh, 0) scale(1.035)" },
      ],
      {
        duration: 650,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "forwards",
      },
    );

    const signal = splash.querySelector<HTMLElement>(".v3-splash-signal");
    animateElement(
      signal,
      [
        {
          opacity: signal ? window.getComputedStyle(signal).opacity : "0",
          transform: "scale(1)",
        },
        { opacity: 0, transform: "scale(1.08)" },
      ],
      {
        duration: 620,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "forwards",
      },
    );
  }

  await delay(exitDuration);
  releaseApp(root, splash, logoTarget);
}

export function startStartupSplashTransition(): void {
  const root = document.getElementById("root");
  const splash = document.getElementById("boot-shell");

  if (!(root instanceof HTMLElement) || !(splash instanceof HTMLElement)) {
    return;
  }

  if (document.documentElement.dataset.startupSplash === "bypass") {
    splash.remove();
    document.documentElement.dataset.startupSplash = "complete";
    return;
  }

  if (document.documentElement.dataset.startupSplashController === "started") {
    return;
  }
  document.documentElement.dataset.startupSplashController = "started";

  root.inert = true;
  root.setAttribute("aria-hidden", "true");

  activeStartupSplashGate = createStartupSplashGate({
    onExit: () => {
      void runStartupSplashExit(root, splash).catch(() => {
        releaseApp(root, splash, document.querySelector<HTMLElement>("[data-startup-logo-target]"));
      });
    },
  });
  if (appReadyBeforeControllerStart) {
    activeStartupSplashGate.markAppReady();
  }
}
