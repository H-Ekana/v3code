export const STARTUP_SPLASH_HOLD_MS = 1_800;
/**
 * The parting is long because the clouds have to still be falling while the composer is
 * still rising — that overlap is the entire parallax effect. Interactivity is handed back
 * at the start of this window, not the end, so length here does not cost responsiveness.
 */
export const STARTUP_SPLASH_EXIT_MS = 1_900;
export const STARTUP_SPLASH_REDUCED_EXIT_MS = 180;
/** Logo flight. Long enough that the slingshot and the arc read as separate beats. */
export const STARTUP_LOGO_FLIGHT_MS = 1_250;
export const STARTUP_LOGO_FLIGHT_DELAY_MS = 120;
/** Samples along the flight path. Enough that the arc reads as a curve, not a polyline. */
const STARTUP_LOGO_FLIGHT_SAMPLES = 32;
/**
 * Paint order back to front. The shell drops below #root during the parting while the
 * other two stay above it, which is what sandwiches rising app content between the sky.
 */
const BOOT_LAYER_IDS = ["boot-shell", "boot-foreground", "boot-logo"] as const;

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
/**
 * Markup of every boot layer, captured before the controller mutates or removes them, so
 * the dev-only replay can rebuild an identical splash without a cold launch. Rebuilding
 * from markup (rather than hiding and reusing the original nodes) also restarts the
 * embedded SVG clocks, which is what makes a replay faithful to a real cold start.
 */
let startupSplashTemplate: readonly string[] | null = null;

function getBootLayers(): HTMLElement[] {
  return BOOT_LAYER_IDS.map((id) => document.getElementById(id)).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
}

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

function cubicBezierPoint(
  start: number,
  controlOne: number,
  controlTwo: number,
  end: number,
  t: number,
): number {
  const inverse = 1 - t;
  return (
    inverse ** 3 * start +
    3 * inverse ** 2 * t * controlOne +
    3 * inverse * t ** 2 * controlTwo +
    t ** 3 * end
  );
}

/**
 * Maps elapsed time onto distance along the flight path.
 *
 * The first third of the duration covers less than a tenth of the path, so the mark
 * visibly loads up before it launches; everything after that decelerates into the sidebar
 * so it settles rather than stops. Baking the timing in here (instead of handing a bezier
 * to `easing`) keeps the arc and the pacing independently tunable.
 */
export function easeStartupLogoSlingshot(t: number): number {
  const anticipation = 0.32;
  if (t < anticipation) {
    const local = t / anticipation;
    return 0.09 * local * local;
  }
  const local = (t - anticipation) / (1 - anticipation);
  return 0.09 + 0.91 * (1 - (1 - local) ** 3);
}

export function buildStartupLogoFlightKeyframes(source: Rect, target: Rect): Keyframe[] {
  const sourceCenterX = source.left + source.width / 2;
  const sourceCenterY = source.top + source.height / 2;
  const targetCenterX = target.left + target.width / 2;
  const targetCenterY = target.top + target.height / 2;
  const deltaX = targetCenterX - sourceCenterX;
  const deltaY = targetCenterY - sourceCenterY;
  const targetScale = Math.min(target.width / source.width, target.height / source.height);

  // Slingshot: the mark sinks down and to the left, sweeps wide while still low, and only
  // then climbs into the sidebar — a J, not a diagonal.
  //
  // The horizontal control weights are what make or break this. A cubic Bezier tracks its
  // control points, so control values near the start (0.16 / 0.34 of the delta) keep the
  // path hugging the origin and dump all the leftward travel into the final moments, which
  // reads as a straight diagonal. Pushing the second control past the target's x
  // (1.02) spends the horizontal distance early and leaves a near-vertical climb at the end.
  const dip = Math.max(72, Math.abs(deltaY) * 0.16);
  const controlOneX = sourceCenterX + deltaX * 0.38;
  const controlOneY = sourceCenterY + dip;
  const controlTwoX = sourceCenterX + deltaX * 1.02;
  const controlTwoY = sourceCenterY + deltaY * 0.3;

  const frames: Keyframe[] = [];
  for (let index = 0; index < STARTUP_LOGO_FLIGHT_SAMPLES; index += 1) {
    const offset = index / (STARTUP_LOGO_FLIGHT_SAMPLES - 1);
    const progress = easeStartupLogoSlingshot(offset);
    const x =
      cubicBezierPoint(sourceCenterX, controlOneX, controlTwoX, targetCenterX, progress) -
      sourceCenterX;
    const y =
      cubicBezierPoint(sourceCenterY, controlOneY, controlTwoY, targetCenterY, progress) -
      sourceCenterY;
    // Scale lags the travel so the mark is still large while it clears the dip, then
    // shrinks hardest through the fast middle of the swing.
    const scale = 1 + (targetScale - 1) * progress ** 1.35;
    // Loose tilt that peaks mid-swing and unwinds as it lands.
    const rotation = -9 * Math.sin(Math.PI * progress);

    frames.push({
      offset,
      transform: `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${rotation.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
    });
  }

  // Land exactly on the measured target rather than on accumulated float drift.
  frames[frames.length - 1] = {
    offset: 1,
    transform: `translate3d(${deltaX}px, ${deltaY}px, 0) rotate(0deg) scale(${targetScale})`,
  };

  return frames;
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
  // Far enough that the band fully clears the viewport instead of stalling mid-screen.
  const verticalDrift = cloud.classList.contains("v3-splash-clouds-mid") ? "48vh" : "78vh";
  return `translate3d(${horizontalDrift}, ${verticalDrift}, 0) scale(1.1)`;
}

function releaseApp(root: HTMLElement, logoTarget: HTMLElement | null): void {
  logoTarget?.style.removeProperty("opacity");
  root.inert = false;
  root.removeAttribute("aria-hidden");
  // Unconditional sweep: layers are also removed on their own timers, and a partially torn
  // down splash would leave an invisible layer pinned above the app forever.
  for (const layer of getBootLayers()) {
    layer.remove();
  }
  document.documentElement.dataset.startupSplash = "complete";
  activeStartupSplashGate = null;
}

async function runStartupSplashExit(root: HTMLElement): Promise<void> {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const exitDuration = resolveStartupSplashExitDuration(prefersReducedMotion);
  const splashLogo = document.querySelector<HTMLElement>(".v3-splash-logo");
  const logoTarget = document.querySelector<HTMLElement>("[data-startup-logo-target]");
  const sourceRect = splashLogo?.getBoundingClientRect() ?? null;
  const targetRect = logoTarget?.getBoundingClientRect() ?? null;

  if (logoTarget && sourceRect && targetRect && !prefersReducedMotion) {
    logoTarget.style.opacity = "0";
  }

  document.documentElement.dataset.startupSplash = "exiting";

  // Hand interactivity back as the parting begins rather than after it finishes. The shell
  // stops taking pointer events via CSS on the same attribute, and the layers above the app
  // are permanently `pointer-events: none`, so nothing is swallowed.
  root.inert = false;
  root.removeAttribute("aria-hidden");

  if (prefersReducedMotion) {
    for (const layer of getBootLayers()) {
      animateElement(layer, [{ opacity: 1 }, { opacity: 0 }], {
        duration: exitDuration,
        easing: "linear",
        fill: "forwards",
      });
    }
  }

  if (!prefersReducedMotion) {
    if (splashLogo && sourceRect && targetRect) {
      // Pacing is baked into the sampled keyframes, so the animation itself runs linear.
      animateElement(splashLogo, buildStartupLogoFlightKeyframes(sourceRect, targetRect), {
        delay: STARTUP_LOGO_FLIGHT_DELAY_MS,
        duration: STARTUP_LOGO_FLIGHT_MS,
        easing: "linear",
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

    // Cross-fade the real sidebar mark up just as the flight lands on it.
    animateElement(logoTarget, [{ opacity: 0 }, { opacity: 1 }], {
      delay: STARTUP_LOGO_FLIGHT_DELAY_MS + STARTUP_LOGO_FLIGHT_MS - 140,
      duration: 180,
      easing: "linear",
      fill: "forwards",
    });

    // Spans both the shell (midground) and the foreground layer.
    const clouds = document.querySelectorAll<HTMLElement>(".v3-splash-cloud-layer");
    clouds.forEach((cloud, index) => {
      const cloudStyle = window.getComputedStyle(cloud);
      animateElement(
        cloud,
        [
          { offset: 0, opacity: cloudStyle.opacity, transform: cloudStyle.transform },
          // Hold opacity through most of the fall. Fading as they drop is what made the
          // clouds read as "dissolving" instead of "falling past" whatever is rising.
          { offset: 0.62, opacity: cloudStyle.opacity },
          { offset: 1, opacity: 0, transform: getCloudExitTransform(cloud) },
        ],
        {
          delay: 80 + index * 70,
          // Slow enough that the bands are still crossing the lower screen while the
          // composer climbs through it. Faster than this and they have cleared out before
          // the composer arrives, which is what made the rise read as "appearing".
          duration: 1_500 + index * 70,
          // Gravity, not a settle — the foreground has to keep falling past the composer.
          easing: "cubic-bezier(0.45, 0, 0.75, 0.6)",
          fill: "forwards",
        },
      );
    });

    const stars = document.querySelector<HTMLElement>(".v3-splash-stars");
    animateElement(
      stars,
      [
        {
          opacity: stars ? window.getComputedStyle(stars).opacity : "0",
          transform: "scale(1)",
        },
        { opacity: 0, transform: "translate3d(-1.2vw, -0.8vh, 0) scale(1.035)" },
      ],
      {
        duration: 1_050,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "forwards",
      },
    );

    const signal = document.querySelector<HTMLElement>(".v3-splash-signal");
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
        duration: 900,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "forwards",
      },
    );
  }

  await delay(exitDuration);
  releaseApp(root, logoTarget);
}

function armStartupSplash(root: HTMLElement): StartupSplashGate {
  root.inert = true;
  root.setAttribute("aria-hidden", "true");

  return createStartupSplashGate({
    onExit: () => {
      void runStartupSplashExit(root).catch(() => {
        releaseApp(root, document.querySelector<HTMLElement>("[data-startup-logo-target]"));
      });
    },
  });
}

export function startStartupSplashTransition(): void {
  const root = document.getElementById("root");
  const layers = getBootLayers();

  if (!(root instanceof HTMLElement) || layers.length === 0) {
    return;
  }

  // Capture before the bypass branch too, so a reload inside an existing tab session still
  // leaves the replay available even though this splash never plays.
  startupSplashTemplate ??= layers.map((layer) => layer.outerHTML);

  if (document.documentElement.dataset.startupSplash === "bypass") {
    for (const layer of layers) {
      layer.remove();
    }
    document.documentElement.dataset.startupSplash = "complete";
    return;
  }

  if (document.documentElement.dataset.startupSplashController === "started") {
    return;
  }
  document.documentElement.dataset.startupSplashController = "started";

  activeStartupSplashGate = armStartupSplash(root);
  if (appReadyBeforeControllerStart) {
    activeStartupSplashGate.markAppReady();
  }
}

export function canReplayStartupSplash(): boolean {
  return startupSplashTemplate !== null;
}

/**
 * Dev-only: rebuild every boot layer and run the full hold + exit choreography again, so
 * the startup sequence can be iterated on without quitting and relaunching the app.
 *
 * The app is already mounted by the time this can be called, so the readiness half of the
 * gate is satisfied immediately and only the hold timer governs the replay.
 */
export function replayStartupSplash(): void {
  const root = document.getElementById("root");

  if (!(root instanceof HTMLElement) || startupSplashTemplate === null) {
    return;
  }
  // A replay is already in flight — ignore rather than stacking two choreographies.
  if (getBootLayers().length > 0) {
    return;
  }

  const host = document.createElement("div");
  host.innerHTML = startupSplashTemplate.join("");

  // Insert in captured order so the layers keep their intended paint order.
  let anchor: HTMLElement = root;
  while (host.firstElementChild instanceof HTMLElement) {
    const layer = host.firstElementChild;
    anchor.after(layer);
    anchor = layer;
  }

  document.documentElement.dataset.startupSplash = "holding";

  activeStartupSplashGate = armStartupSplash(root);
  activeStartupSplashGate.markAppReady();
}
