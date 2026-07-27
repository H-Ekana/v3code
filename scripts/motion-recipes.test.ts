import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

/*
 * Contract guard for the shared interaction language in
 * `apps/web/src/styles/motion.css`.
 *
 * This lives at repo scope rather than inside `apps/web` for two reasons:
 * the web package forbids `node:` builtins (browser code must not reach for
 * them), and the unit pipeline resolves `?raw` CSS imports to an empty string
 * — which silently passes every assertion below. Reading the file directly is
 * the only way this guard actually guards anything.
 *
 * Its job is to fail loudly when a later slice drifts the tokens, drops a
 * reduced-motion fallback, or creeps past the plan's intensity ceiling. See
 * `docs/project/nightly-interaction-motion-polish-plan.md`.
 */
const source = NodeFS.readFileSync(
  NodeURL.fileURLToPath(new URL("../apps/web/src/styles/motion.css", import.meta.url)),
  "utf8",
);

/** Recipes that animate, and therefore owe a reduced-motion alternative. */
const ANIMATING_RECIPES = [
  "motion-focus",
  "motion-hover",
  "motion-press",
  "motion-resting",
  "motion-selected",
  "motion-destructive",
  "motion-pending",
  "motion-arrival",
  "motion-completion",
];

function reducedMotionBlock(): string {
  const start = source.indexOf("@media (prefers-reduced-motion: reduce)");
  expect(start).toBeGreaterThan(-1);

  // Walk braces so nested rules stay inside the captured block.
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  throw new Error("unterminated prefers-reduced-motion block");
}

function captureGroup(pattern: RegExp, subject: string, label: string): string {
  const match = pattern.exec(subject);
  if (!match?.[1]) throw new Error(`${label} not found`);
  return match[1];
}

describe("motion.css token contract", () => {
  it("declares the plan's exact duration ladder", () => {
    expect(source).toContain("--motion-press: 100ms;");
    expect(source).toContain("--motion-hover: 140ms;");
    expect(source).toContain("--motion-state: 200ms;");
    expect(source).toContain("--motion-layout: 240ms;");
    expect(source).toContain("--motion-accent: 300ms;");
    expect(source).toContain("--motion-signature: 480ms;");
  });

  it("declares the plan's exact easing curves", () => {
    expect(source).toContain("--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);");
    expect(source).toContain("--ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);");
    expect(source).toContain("--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);");
  });

  it("orders the cross-portal layer roles without ties", () => {
    const roles = ["sticky-chrome", "backdrop", "modal", "dropdown", "toast", "tooltip"];
    const values = roles.map((role) =>
      Number(captureGroup(new RegExp(`--layer-${role}: (\\d+);`), source, `--layer-${role}`)),
    );

    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("motion.css reduced-motion contract", () => {
  it("gives every animating recipe a reduced-motion alternative", () => {
    const block = reducedMotionBlock();

    for (const recipe of ANIMATING_RECIPES) {
      expect(block, `${recipe} has no reduced-motion branch`).toContain(`.${recipe}`);
    }
  });

  it("preserves meaning instead of freezing animation mid-flight", () => {
    const block = reducedMotionBlock();

    // A frozen keyframe reads as a stuck spinner. The one-shot recipes
    // crossfade instead, so nothing is left paused part-way through.
    expect(block).toContain("motion-arrival-reduced");
    expect(block).toContain("animation: none");
  });
});

describe("motion.css intensity ceiling", () => {
  it("keeps every glow within the plan's 6px bound", () => {
    const shadows = source.match(/box-shadow:[^;]+;/g) ?? [];
    expect(shadows.length).toBeGreaterThan(0);

    const oversized = shadows.flatMap((shadow) =>
      (shadow.match(/(\d+(?:\.\d+)?)px/g) ?? [])
        .map((length) => Number(length.replace("px", "")))
        .filter((length) => length > 6)
        .map((length) => `${length}px in "${shadow.replace(/\s+/g, " ")}"`),
    );

    expect(oversized).toEqual([]);
  });

  it("keeps the press response inside Level 1 bounds", () => {
    const press = captureGroup(
      /\.motion-press:active[^{]*\{([^}]+)\}/,
      source,
      ".motion-press:active",
    );

    const translate = Number(captureGroup(/translateY\((\d+(?:\.\d+)?)px\)/, press, "translateY"));
    expect(translate).toBeLessThanOrEqual(2);

    const scale = Number(captureGroup(/scale\((\d+(?:\.\d+)?)\)/, press, "scale"));
    expect(scale).toBeGreaterThanOrEqual(0.98);
    expect(scale).toBeLessThanOrEqual(1.02);
  });
});
