export const STARTUP_SPLASH_HOLD_MS = 1_600;
/**
 * The strike. Runs at the head of the parting rather than during the hold, so the impact is
 * locked to the moment the choreography actually begins — the gate can fire late if the app
 * is slow to commit, and a meteor scheduled against the hold would land on nothing.
 */
export const STARTUP_METEOR_MS = 560;
/**
 * When the sky starts to part — after the strike, and after the mark has begun its recoil.
 * Act 3 deliberately waits: with the logo already travelling, the eye is free to follow the
 * composer instead of splitting between them.
 */
export const STARTUP_PARTING_DELAY_MS = 900;
/**
 * The parting is long because the clouds have to still be falling while the composer is
 * still rising — that overlap is the entire parallax effect. Interactivity is handed back
 * at the start of this window, not the end, so length here does not cost responsiveness.
 */
export const STARTUP_SPLASH_EXIT_MS = 2_500;
/** 180ms of linear full-screen dissolve reads as a hard cut, which is its own jarring. */
export const STARTUP_SPLASH_REDUCED_EXIT_MS = 300;
/** Logo flight. Long enough that the recoil and the arc read as separate beats. */
export const STARTUP_LOGO_FLIGHT_MS = 900;
/** Starts on impact — the strike is what launches it. */
export const STARTUP_LOGO_FLIGHT_DELAY_MS = STARTUP_METEOR_MS;
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
 * The strike, travelling down-and-left into the mark from the upper right. The head sits at
 * the group's local origin, so the final zero transform lands it exactly on the logo, and
 * `scaleX` applies along the direction of travel because it follows the rotation — that
 * stretch is what reads as speed, not a blur.
 */
export function buildHeroMeteorKeyframes(): Keyframe[] {
  const angle = "rotate(142deg)";
  return [
    { offset: 0, opacity: 0, transform: `translate(620px, -478px) ${angle} scaleX(0.3)` },
    { offset: 0.1, opacity: 0.95, transform: `translate(548px, -422px) ${angle} scaleX(0.5)` },
    { offset: 0.75, opacity: 0.92, transform: `translate(155px, -120px) ${angle} scaleX(1)` },
    { offset: 0.94, opacity: 0.85, transform: `translate(0px, 0px) ${angle} scaleX(1.06)` },
    { offset: 1, opacity: 0, transform: `translate(0px, 0px) ${angle} scaleX(1.06)` },
  ];
}

/** Contact bloom, timed to the frame the head reaches the mark. */
export function buildImpactBloomKeyframes(): Keyframe[] {
  return [
    { offset: 0, opacity: 0, transform: "scale(0.55)" },
    { offset: 0.18, opacity: 0.85, transform: "scale(0.92)" },
    { offset: 1, opacity: 0, transform: "scale(1.45)" },
  ];
}

/** Share of the flight spent absorbing the meteor's impact before recovering. */
const STARTUP_LOGO_RECOIL_FRACTION = 0.22;
/** How far the strike drives the mark down, as a share of the distance it must climb. */
const STARTUP_LOGO_RECOIL_DEPTH = 0.42;
/** Minimum recoil in px, so the knock still reads on a short window. */
const STARTUP_LOGO_RECOIL_MIN_PX = 150;

/**
 * The mark's flight, authored as two physically distinct strokes rather than one curve.
 *
 * A single cubic Bezier could not express this. Its dip is a *control point offset*, and a
 * cubic only travels roughly a fifth of the way toward its controls — a 72px control offset
 * produced a 15px excursion on a 900px viewport, which is invisible. Worse, the curve spent
 * 87% of its horizontal distance in the first half of the duration, so the long tail of the
 * animation was a near-vertical settle and the whole thing read as a diagonal drift.
 *
 * Authoring the strokes directly means a recoil distance is a real distance, and each stroke
 * gets its own pacing:
 *
 *   1. RECOIL — the meteor's strike drives the mark down and slightly along the impact
 *      vector. Fast, then decelerating: it is absorbing energy.
 *   2. RECOVERY — a wide arc up and left into the sidebar, pacing chosen so the horizontal
 *      travel is spread across the duration instead of front-loaded.
 */
export function buildStartupLogoFlightKeyframes(source: Rect, target: Rect): Keyframe[] {
  const sourceCenterX = source.left + source.width / 2;
  const sourceCenterY = source.top + source.height / 2;
  const targetCenterX = target.left + target.width / 2;
  const targetCenterY = target.top + target.height / 2;
  const deltaX = targetCenterX - sourceCenterX;
  const deltaY = targetCenterY - sourceCenterY;
  const targetScale = Math.min(target.width / source.width, target.height / source.height);

  // The meteor arrives from upper right, so its impact drives the mark down and a little
  // left. This is a real px excursion, not a control-point hint.
  const recoilY = Math.max(
    STARTUP_LOGO_RECOIL_MIN_PX,
    Math.abs(deltaY) * STARTUP_LOGO_RECOIL_DEPTH,
  );
  const recoilX = deltaX * 0.07;

  // Recovery arc: leaves the low point heading left, then turns upward late, so the climb
  // into the sidebar is the final gesture rather than the whole gesture.
  const controlOneX = recoilX + deltaX * 0.42;
  const controlOneY = recoilY + Math.abs(deltaY) * 0.06;
  const controlTwoX = deltaX * 0.98;
  const controlTwoY = deltaY * 0.34;

  const frames: Keyframe[] = [];
  for (let index = 0; index < STARTUP_LOGO_FLIGHT_SAMPLES; index += 1) {
    const offset = index / (STARTUP_LOGO_FLIGHT_SAMPLES - 1);
    let x: number;
    let y: number;
    let travelled: number;

    if (offset <= STARTUP_LOGO_RECOIL_FRACTION) {
      // Struck: quick displacement that decelerates as the energy is absorbed.
      const local = offset / STARTUP_LOGO_RECOIL_FRACTION;
      const eased = 1 - (1 - local) ** 2;
      x = recoilX * eased;
      y = recoilY * eased;
      travelled = 0;
    } else {
      const local = (offset - STARTUP_LOGO_RECOIL_FRACTION) / (1 - STARTUP_LOGO_RECOIL_FRACTION);
      // Exponent below 1 would front-load; above ~2 would stall. 1.7 spreads the horizontal
      // distance closely enough to even that the arc reads as an arc.
      const eased = 1 - (1 - local) ** 1.7;
      x = cubicBezierPoint(recoilX, controlOneX, controlTwoX, deltaX, eased);
      y = cubicBezierPoint(recoilY, controlOneY, controlTwoY, deltaY, eased);
      travelled = eased;
    }

    // Scale holds through the recoil — the mark is still full size while it is knocked down —
    // then shrinks across the recovery.
    const scale = 1 + (targetScale - 1) * travelled ** 1.25;
    // Tilt peaks mid-recovery and unwinds slightly past level before settling. Both terms
    // vanish at travelled = 1, so it still lands perfectly square.
    const rotation =
      -10 * Math.sin(Math.PI * travelled) +
      2.4 * Math.sin(2 * Math.PI * travelled) * travelled ** 2;

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

type CloudBandMotion = {
  readonly x: string;
  readonly y: string;
  readonly scale: number;
  readonly delayMs: number;
  readonly durationMs: number;
  readonly easing: string;
};

/**
 * Per-band depth. Nearer bands travel further, faster, and scale up more — a band that is
 * about to pass the viewer accelerates and grows.
 *
 * This spread is the effect. Previously every foreground band moved 78vh with a ~14% spread
 * in duration, which is one plane wearing three costumes: depth is read from *relative*
 * velocity, so near-identical motion across layers reads as a single flat sheet. The ratio
 * here is roughly 2.8x between the midground and the nearest foreground band, plus a scale
 * gradient, which is an independent depth cue on its own.
 */
export function resolveCloudBandMotion(className: string): CloudBandMotion {
  if (className.includes("v3-splash-clouds-mid")) {
    // Far away: drifts, barely grows, and settles rather than falls.
    return {
      x: "-1.5vw",
      y: "34vh",
      scale: 1.04,
      delayMs: 0,
      durationMs: 1_320,
      easing: "cubic-bezier(0.3, 0, 0.5, 1)",
    };
  }
  if (className.includes("v3-splash-clouds-foreground-left")) {
    return {
      x: "-9vw",
      y: "86vh",
      scale: 1.16,
      delayMs: 40,
      durationMs: 1_200,
      easing: "cubic-bezier(0.45, 0, 0.75, 0.6)",
    };
  }
  if (className.includes("v3-splash-clouds-foreground-right")) {
    return {
      x: "9vw",
      y: "88vh",
      scale: 1.16,
      delayMs: 90,
      durationMs: 1_230,
      easing: "cubic-bezier(0.45, 0, 0.75, 0.6)",
    };
  }
  // Foreground centre: the nearest band, and the one the composer rises through.
  return {
    x: "0",
    y: "96vh",
    scale: 1.2,
    delayMs: 20,
    durationMs: 1_150,
    easing: "cubic-bezier(0.45, 0, 0.75, 0.6)",
  };
}

function getCloudExitTransform(motion: CloudBandMotion): string {
  return `translate3d(${motion.x}, ${motion.y}, 0) scale(${motion.scale})`;
}

/**
 * A `fill: forwards` animation keeps applying after it finishes, and it lives in the
 * Animation cascade origin — which outranks author CSS permanently. The handoff animation on
 * the sidebar mark therefore pinned it to `opacity: 1` forever, so every later rule intended
 * to hide it during the hold was dead on arrival. Anything we drive with `forwards` on an
 * element that outlives the splash has to be cancelled explicitly.
 */
function cancelStartupAnimations(element: HTMLElement | null): void {
  if (!element || typeof element.getAnimations !== "function") {
    return;
  }
  for (const animation of element.getAnimations()) {
    animation.cancel();
  }
}

function releaseApp(root: HTMLElement, logoTarget: HTMLElement | null): void {
  cancelStartupAnimations(logoTarget);
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

  // Clear anything a previous run (or a dev replay) left pinned on the mark before the CSS
  // hold rule and the new handoff animation are supposed to take over.
  cancelStartupAnimations(logoTarget);

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
    // Act 1: the strike. Everything after this is a consequence of it.
    animateElement(
      document.querySelector<HTMLElement>(".v3-hero-meteor-body"),
      buildHeroMeteorKeyframes(),
      {
        duration: STARTUP_METEOR_MS,
        easing: "cubic-bezier(0.34, 0, 0.5, 1)",
        fill: "forwards",
      },
    );
    animateElement(
      document.querySelector<HTMLElement>(".v3-splash-impact"),
      buildImpactBloomKeyframes(),
      {
        delay: STARTUP_METEOR_MS - 40,
        duration: 460,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "forwards",
      },
    );

    // Act 2: knocked loose by the impact, the mark recoils and departs.
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
          delay: STARTUP_LOGO_FLIGHT_DELAY_MS,
          duration: 520,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          fill: "forwards",
        },
      );
    }

    // The handoff happens ON touchdown, never before it.
    //
    // This previously started 140ms early as a "cross-fade", which meant the sidebar mark
    // faded up while the flying one was still visibly in transit — so the destination logo
    // appeared before anything had arrived to deliver it, which is precisely the thing the
    // flight is supposed to accomplish. The overlap is now a single 70ms swap at the landing
    // frame: short enough to hide the difference between the two treatments, not long enough
    // for both to read as present at once.
    const handoffDelay = STARTUP_LOGO_FLIGHT_DELAY_MS + STARTUP_LOGO_FLIGHT_MS;
    animateElement(splashLogo, [{ opacity: 1 }, { opacity: 0 }], {
      delay: handoffDelay,
      duration: 70,
      easing: "linear",
      fill: "forwards",
    });
    animateElement(logoTarget, [{ opacity: 0 }, { opacity: 1 }], {
      delay: handoffDelay,
      duration: 70,
      easing: "linear",
      fill: "forwards",
    });

    // Act 3: the sky parts.
    // Spans both the shell (midground) and the foreground layer.
    const clouds = document.querySelectorAll<HTMLElement>(".v3-splash-cloud-layer");
    clouds.forEach((cloud) => {
      const cloudStyle = window.getComputedStyle(cloud);
      const motion = resolveCloudBandMotion(cloud.className);
      animateElement(
        cloud,
        [
          { offset: 0, opacity: cloudStyle.opacity, transform: cloudStyle.transform },
          // Hold opacity through most of the fall. Fading as they drop is what made the
          // clouds read as "dissolving" instead of "falling past" whatever is rising.
          { offset: 0.68, opacity: cloudStyle.opacity },
          { offset: 1, opacity: 0, transform: getCloudExitTransform(motion) },
        ],
        {
          delay: STARTUP_PARTING_DELAY_MS + motion.delayMs,
          duration: motion.durationMs,
          easing: motion.easing,
          fill: "forwards",
        },
      );
    });

    const galaxies = document.querySelector<HTMLElement>(".v3-splash-galaxies");
    animateElement(
      galaxies,
      [
        {
          opacity: galaxies ? window.getComputedStyle(galaxies).opacity : "0",
          transform: "scale(1)",
        },
        { opacity: 0, transform: "translate3d(-0.6vw, -0.4vh, 0) scale(1.02)" },
      ],
      {
        delay: STARTUP_PARTING_DELAY_MS,
        duration: 1_150,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "forwards",
      },
    );

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
        delay: STARTUP_PARTING_DELAY_MS,
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
        delay: STARTUP_PARTING_DELAY_MS,
        duration: 900,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "forwards",
      },
    );

    // The dust falls with the sky. The far field drifts down gently like the midground band;
    // the near field drops much further and faster on the same gravity curve as the near cloud
    // bands. Both hold their density through ~60% of the fall before fading, so they read as
    // falling past the rising app rather than dissolving in place — the same trick the clouds
    // use. These fields live inside the boot layers (not ancestors of the app), so animating
    // their opacity here is safe.
    const farMotes = document.querySelector<HTMLElement>(".v3-splash-motes-far");
    animateElement(
      farMotes,
      [
        {
          offset: 0,
          opacity: farMotes ? window.getComputedStyle(farMotes).opacity : "1",
          transform: "translate3d(0, 0, 0)",
        },
        { offset: 0.6, opacity: farMotes ? window.getComputedStyle(farMotes).opacity : "1" },
        { offset: 1, opacity: 0, transform: "translate3d(0, 30vh, 0)" },
      ],
      {
        delay: STARTUP_PARTING_DELAY_MS,
        duration: 1_200,
        easing: "cubic-bezier(0.3, 0, 0.5, 1)",
        fill: "forwards",
      },
    );

    const nearMotes = document.querySelector<HTMLElement>(".v3-splash-motes-near");
    animateElement(
      nearMotes,
      [
        {
          offset: 0,
          opacity: nearMotes ? window.getComputedStyle(nearMotes).opacity : "1",
          transform: "translate3d(0, 0, 0)",
        },
        { offset: 0.6, opacity: nearMotes ? window.getComputedStyle(nearMotes).opacity : "1" },
        { offset: 1, opacity: 0, transform: "translate3d(0, 80vh, 0)" },
      ],
      {
        delay: STARTUP_PARTING_DELAY_MS + 20,
        duration: 900,
        easing: "cubic-bezier(0.45, 0, 0.75, 0.6)",
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

  // Clear the previous run's handoff before the hold begins, not at exit. A finished
  // `fill: forwards` animation outranks the CSS rule that hides the mark, so leaving it in
  // place would pin the sidebar logo visible for the whole hold on any replay.
  cancelStartupAnimations(document.querySelector<HTMLElement>("[data-startup-logo-target]"));

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
