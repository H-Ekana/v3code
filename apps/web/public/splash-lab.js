/*
 * Driver for splash-lab.html — a mirror of apps/web/src/startupSplash.ts.
 *
 * The lab page's CSS and boot-layer markup are generated verbatim from index.html, so the
 * visual layer cannot drift. This file is a hand port of the controller and must be kept in
 * step with startupSplash.ts by hand; the constants are grouped at the top to make that easy.
 */
export const T = {
  hold: 1_600,
  exit: 2_500,
  meteor: 560,
  parting: 900,
  flightDelay: 560,
  flight: 900,
};

const RECOIL_FRACTION = 0.22;
const RECOIL_DEPTH = 0.42;
const RECOIL_MIN_PX = 150;
const SAMPLES = 32;
const LAYER_IDS = ["boot-shell", "boot-foreground", "boot-logo"];

const cubic = (p0, c1, c2, p1, t) => {
  const i = 1 - t;
  return i ** 3 * p0 + 3 * i ** 2 * t * c1 + 3 * i * t ** 2 * c2 + t ** 3 * p1;
};

export function heroMeteorKeyframes() {
  const a = "rotate(142deg)";
  return [
    { offset: 0, opacity: 0, transform: `translate(620px, -478px) ${a} scaleX(0.3)` },
    { offset: 0.1, opacity: 0.95, transform: `translate(548px, -422px) ${a} scaleX(0.5)` },
    { offset: 0.75, opacity: 0.92, transform: `translate(155px, -120px) ${a} scaleX(1)` },
    { offset: 0.94, opacity: 0.85, transform: `translate(0px, 0px) ${a} scaleX(1.06)` },
    { offset: 1, opacity: 0, transform: `translate(0px, 0px) ${a} scaleX(1.06)` },
  ];
}

export function impactKeyframes() {
  return [
    { offset: 0, opacity: 0, transform: "scale(0.55)" },
    { offset: 0.18, opacity: 0.85, transform: "scale(0.92)" },
    { offset: 1, opacity: 0, transform: "scale(1.45)" },
  ];
}

export function flightKeyframes(source, target) {
  const sx = source.left + source.width / 2;
  const sy = source.top + source.height / 2;
  const tx = target.left + target.width / 2;
  const ty = target.top + target.height / 2;
  const dx = tx - sx;
  const dy = ty - sy;
  const scaleTo = Math.min(target.width / source.width, target.height / source.height);
  const recoilY = Math.max(RECOIL_MIN_PX, Math.abs(dy) * RECOIL_DEPTH);
  const recoilX = dx * 0.07;
  const c1x = recoilX + dx * 0.42;
  const c1y = recoilY + Math.abs(dy) * 0.06;
  const c2x = dx * 0.98;
  const c2y = dy * 0.34;
  const frames = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const o = i / (SAMPLES - 1);
    let x;
    let y;
    let travelled;
    if (o <= RECOIL_FRACTION) {
      const l = o / RECOIL_FRACTION;
      const e = 1 - (1 - l) ** 2;
      x = recoilX * e;
      y = recoilY * e;
      travelled = 0;
    } else {
      const l = (o - RECOIL_FRACTION) / (1 - RECOIL_FRACTION);
      const e = 1 - (1 - l) ** 1.7;
      x = cubic(recoilX, c1x, c2x, dx, e);
      y = cubic(recoilY, c1y, c2y, dy, e);
      travelled = e;
    }
    const scale = 1 + (scaleTo - 1) * travelled ** 1.25;
    const rot =
      -10 * Math.sin(Math.PI * travelled) +
      2.4 * Math.sin(2 * Math.PI * travelled) * travelled ** 2;
    frames.push({
      offset: o,
      transform: `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
    });
  }
  frames[frames.length - 1] = {
    offset: 1,
    transform: `translate3d(${dx}px, ${dy}px, 0) rotate(0deg) scale(${scaleTo})`,
  };
  return frames;
}

export function cloudBandMotion(className) {
  if (className.includes("v3-splash-clouds-mid")) {
    return {
      x: "-1.5vw",
      y: "34vh",
      scale: 1.04,
      delayMs: 0,
      durationMs: 1320,
      easing: "cubic-bezier(0.3, 0, 0.5, 1)",
    };
  }
  if (className.includes("v3-splash-clouds-foreground-left")) {
    return {
      x: "-9vw",
      y: "86vh",
      scale: 1.16,
      delayMs: 40,
      durationMs: 1200,
      easing: "cubic-bezier(0.45, 0, 0.75, 0.6)",
    };
  }
  if (className.includes("v3-splash-clouds-foreground-right")) {
    return {
      x: "9vw",
      y: "88vh",
      scale: 1.16,
      delayMs: 90,
      durationMs: 1230,
      easing: "cubic-bezier(0.45, 0, 0.75, 0.6)",
    };
  }
  return {
    x: "0",
    y: "96vh",
    scale: 1.2,
    delayMs: 20,
    durationMs: 1150,
    easing: "cubic-bezier(0.45, 0, 0.75, 0.6)",
  };
}

const animate = (el, frames, opts) =>
  el && typeof el.animate === "function" ? el.animate(frames, opts) : null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const layers = () => LAYER_IDS.map((id) => document.getElementById(id)).filter(Boolean);

let template = null;

async function runExit() {
  const root = document.getElementById("root");
  const splashLogo = document.querySelector(".v3-splash-logo");
  const logoTarget = document.querySelector("[data-startup-logo-target]");
  const sourceRect = splashLogo ? splashLogo.getBoundingClientRect() : null;
  const targetRect = logoTarget ? logoTarget.getBoundingClientRect() : null;
  if (logoTarget) for (const a of logoTarget.getAnimations()) a.cancel();
  if (logoTarget && sourceRect && targetRect) logoTarget.style.opacity = "0";

  document.documentElement.dataset.startupSplash = "exiting";
  root.inert = false;

  animate(document.querySelector(".v3-hero-meteor-body"), heroMeteorKeyframes(), {
    duration: T.meteor,
    easing: "cubic-bezier(0.34, 0, 0.5, 1)",
    fill: "forwards",
  });
  animate(document.querySelector(".v3-splash-impact"), impactKeyframes(), {
    delay: T.meteor - 40,
    duration: 460,
    easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    fill: "forwards",
  });

  if (splashLogo && sourceRect && targetRect) {
    animate(splashLogo, flightKeyframes(sourceRect, targetRect), {
      delay: T.flightDelay,
      duration: T.flight,
      easing: "linear",
      fill: "forwards",
    });
  }
  const handoff = T.flightDelay + T.flight;
  animate(splashLogo, [{ opacity: 1 }, { opacity: 0 }], {
    delay: handoff,
    duration: 70,
    easing: "linear",
    fill: "forwards",
  });
  animate(logoTarget, [{ opacity: 0 }, { opacity: 1 }], {
    delay: handoff,
    duration: 70,
    easing: "linear",
    fill: "forwards",
  });

  for (const cloud of document.querySelectorAll(".v3-splash-cloud-layer")) {
    const cs = getComputedStyle(cloud);
    const m = cloudBandMotion(cloud.className);
    animate(
      cloud,
      [
        { offset: 0, opacity: cs.opacity, transform: cs.transform },
        { offset: 0.68, opacity: cs.opacity },
        { offset: 1, opacity: 0, transform: `translate3d(${m.x}, ${m.y}, 0) scale(${m.scale})` },
      ],
      { delay: T.parting + m.delayMs, duration: m.durationMs, easing: m.easing, fill: "forwards" },
    );
  }

  const galaxies = document.querySelector(".v3-splash-galaxies");
  animate(
    galaxies,
    [
      { opacity: galaxies ? getComputedStyle(galaxies).opacity : "0", transform: "scale(1)" },
      { opacity: 0, transform: "translate3d(-0.6vw, -0.4vh, 0) scale(1.02)" },
    ],
    { delay: T.parting, duration: 1150, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" },
  );

  const stars = document.querySelector(".v3-splash-stars");
  animate(
    stars,
    [
      { opacity: stars ? getComputedStyle(stars).opacity : "0", transform: "scale(1)" },
      { opacity: 0, transform: "translate3d(-1.2vw, -0.8vh, 0) scale(1.035)" },
    ],
    { delay: T.parting, duration: 1050, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" },
  );

  const signal = document.querySelector(".v3-splash-signal");
  animate(
    signal,
    [
      { opacity: signal ? getComputedStyle(signal).opacity : "0", transform: "scale(1)" },
      { opacity: 0, transform: "scale(1.08)" },
    ],
    { delay: T.parting, duration: 900, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" },
  );

  // Dust falls with the sky: far field gentle and short, near field far and fast on gravity.
  const farMotes = document.querySelector(".v3-splash-motes-far");
  animate(
    farMotes,
    [
      {
        offset: 0,
        opacity: farMotes ? getComputedStyle(farMotes).opacity : "1",
        transform: "translate3d(0, 0, 0)",
      },
      { offset: 0.6, opacity: farMotes ? getComputedStyle(farMotes).opacity : "1" },
      { offset: 1, opacity: 0, transform: "translate3d(0, 30vh, 0)" },
    ],
    { delay: T.parting, duration: 1200, easing: "cubic-bezier(0.3, 0, 0.5, 1)", fill: "forwards" },
  );

  const nearMotes = document.querySelector(".v3-splash-motes-near");
  animate(
    nearMotes,
    [
      {
        offset: 0,
        opacity: nearMotes ? getComputedStyle(nearMotes).opacity : "1",
        transform: "translate3d(0, 0, 0)",
      },
      { offset: 0.6, opacity: nearMotes ? getComputedStyle(nearMotes).opacity : "1" },
      { offset: 1, opacity: 0, transform: "translate3d(0, 80vh, 0)" },
    ],
    {
      delay: T.parting + 20,
      duration: 900,
      easing: "cubic-bezier(0.45, 0, 0.75, 0.6)",
      fill: "forwards",
    },
  );

  await wait(T.exit);
  if (logoTarget) logoTarget.style.removeProperty("opacity");
  for (const l of layers()) l.remove();
  document.documentElement.dataset.startupSplash = "complete";
}

export function replay() {
  const root = document.getElementById("root");
  if (layers().length > 0) return;
  const prior = document.querySelector("[data-startup-logo-target]");
  if (prior) for (const a of prior.getAnimations()) a.cancel();
  const host = document.createElement("div");
  host.innerHTML = template;
  let anchor = root;
  while (host.firstElementChild) {
    anchor.after(host.firstElementChild);
    anchor = anchor.nextElementSibling;
  }
  document.documentElement.dataset.startupSplash = "holding";
  root.inert = true;
  setTimeout(runExit, T.hold);
}

template = layers()
  .map((l) => l.outerHTML)
  .join("");
document.getElementById("lab-replay").addEventListener("click", replay);
document.getElementById("root").inert = true;
setTimeout(runExit, T.hold);
window.__labReplay = replay;
