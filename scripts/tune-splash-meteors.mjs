/*
 * Normalises the ambient meteors in apps/web/public/v3-splash-stars.svg.
 *
 * A streak is only visible between 71% and 84% of its cycle, so
 *   firstVisible   = 0.71 * cycle - |delay|
 *   visibleFor     = 0.13 * cycle
 * Those windows are long (1.0-1.8s) relative to the ~1.6s hold, so meteors stack up fast:
 * six of them read as a shower, not a night sky. Three staggered across the hold gives a
 * steady trickle with usually one or two on screen, which is enough for the hero strike to
 * feel like one of many rather than an event out of nowhere.
 *
 * This script REPLACES whatever meteor set is currently in the file, so it is safe to re-run
 * after retuning. Only the `shooting-star` groups are touched; the paired `meteor-origin`
 * stars and every other element are left alone.
 *
 * Run: node scripts/tune-splash-meteors.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "apps/web/public/v3-splash-stars.svg";

// appearAt is seconds from SVG load; the hold is ~1.6s.
const METEORS = {
  a: {
    cycle: 8.2,
    appearAt: 0.2,
    from: [1386, 206],
    mid: [1034, 453],
    to: [940, 519],
    angle: 145,
    tail: 168,
    glow: 138,
    core: 72,
    head: 3,
    width: 2.8,
  },
  b: {
    cycle: 10.7,
    appearAt: 0.75,
    from: [844, 142],
    mid: [1200, 374],
    to: [1292, 434],
    angle: 34,
    tail: 150,
    glow: 124,
    core: 62,
    head: 2.8,
    width: 2.5,
  },
  c: {
    cycle: 13.4,
    appearAt: 1.25,
    from: [492, 105],
    mid: [838, 346],
    to: [930, 410],
    angle: 35,
    tail: 158,
    glow: 130,
    core: 66,
    head: 2.9,
    width: 2.6,
  },
};

const KEYS = Object.keys(METEORS);
const delayFor = (m) => +(0.71 * m.cycle - m.appearAt).toFixed(3);

let svg = readFileSync(FILE, "utf8");

// --- 1. Strip every existing meteor definition so the script is idempotent. ---
svg = svg.replace(/\n?\s*<g class="shooting-star shooting-star--[a-z]">[\s\S]*?<\/g>/g, "");
svg = svg.replace(/\n?\s*@keyframes shooting-star-[a-z] \{[\s\S]*?\n    \}/g, "");
svg = svg.replace(
  /\n?\s*(?:\.meteor-origin--[a-z],\n)?\s*\.shooting-star--[a-z] \{\n\s*animation-duration:[^}]*\}/g,
  "",
);
svg = svg.replace(
  /\n?\s*\.shooting-star--[a-z] \{\n\s*animation-name: shooting-star-[a-z];\n\s*\}/g,
  "",
);

// --- 2. Timing rules, re-inserted after the shared .meteor-origin rule. ---
const timing = KEYS.map(
  (k) =>
    `    .meteor-origin--${k},\n    .shooting-star--${k} {\n      animation-duration: ${METEORS[k].cycle}s;\n      animation-delay: -${delayFor(METEORS[k])}s;\n    }`,
).join("\n");
svg = svg.replace(
  /(\.meteor-origin \{\n\s*animation-name: meteor-origin-hide;\n\s*\})/,
  `$1\n${timing}`,
);

// --- 3. animation-name bindings, after the shared .shooting-star rule. ---
const names = KEYS.map(
  (k) => `    .shooting-star--${k} {\n      animation-name: shooting-star-${k};\n    }`,
).join("\n");
svg = svg.replace(
  /(\.shooting-star \{[\s\S]*?will-change: transform, opacity;\n\s*\})/,
  `$1\n${names}`,
);

// --- 4. Keyframes, before the origin-hide keyframes. ---
const keyframes = KEYS.map((k) => {
  const m = METEORS[k];
  return `    @keyframes shooting-star-${k} {
      0%,
      71% {
        opacity: 0;
        transform: translate(${m.from[0]}px, ${m.from[1]}px) rotate(${m.angle}deg) scaleX(.3);
      }

      72% {
        opacity: .94;
        transform: translate(${m.from[0]}px, ${m.from[1]}px) rotate(${m.angle}deg) scaleX(.42);
      }

      80.5% {
        opacity: .86;
        transform: translate(${m.mid[0]}px, ${m.mid[1]}px) rotate(${m.angle}deg) scaleX(1);
      }

      84%,
      100% {
        opacity: 0;
        transform: translate(${m.to[0]}px, ${m.to[1]}px) rotate(${m.angle}deg) scaleX(1.06);
      }
    }`;
}).join("\n\n");
svg = svg.replace(/(\n\s*@keyframes meteor-origin-hide)/, `\n${keyframes}\n$1`);

// --- 5. Markup, restored just before the closing tag. ---
const bodies = KEYS.map((k) => {
  const m = METEORS[k];
  return `  <g class="shooting-star shooting-star--${k}">
    <path class="meteor-glow" d="M-${m.glow} 0H-5"/>
    <path d="M-${m.tail} 0H0" stroke="url(#meteor-tail)" stroke-width="${m.width}" stroke-linecap="round"/>
    <path class="meteor-core" d="M-${m.core} 0H0"/>
    <circle class="meteor-head" r="${m.head}"/>
  </g>`;
}).join("\n");
svg = svg.replace(/\n*<\/svg>\s*$/, `\n${bodies}\n</svg>\n`);

// Stripping and re-inserting leaves a stray blank line each pass; without this the file
// grows by one line every run and the script is not safely re-runnable.
svg = svg.replace(/\n{3,}/g, "\n\n");

writeFileSync(FILE, svg, "utf8");

console.log("ambient meteors (visible window, seconds from SVG load; hold is ~1.6s):");
for (const k of KEYS) {
  const m = METEORS[k];
  const end = +(m.appearAt + 0.13 * m.cycle).toFixed(2);
  console.log(
    `  --${k}: ${m.appearAt.toFixed(2)}s -> ${end}s   cycle ${m.cycle}s   delay -${delayFor(m)}s`,
  );
}
console.log(`total: ${KEYS.length}`);
