import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as NodeURL from "node:url";

/*
 * Contract guard for the shared interaction language in
 * `apps/web/src/styles/motion.css`.
 *
 * This lives at repo scope rather than inside `apps/web` for two reasons: the
 * web package forbids `node:` builtins (browser code must not reach for them),
 * and the unit pipeline resolves `?raw` CSS imports to an empty string — which
 * silently passes every assertion below. Reading the file is the only way this
 * guard actually guards anything, and repo-wide lint requires that read go
 * through Effect's `FileSystem` rather than `node:fs`.
 *
 * Its job is to fail loudly when a later slice drifts the tokens, drops a
 * reduced-motion fallback, or creeps past the plan's intensity ceiling. See
 * `docs/project/nightly-interaction-motion-polish-plan.md`.
 */
const MOTION_CSS = NodeURL.fileURLToPath(
  new URL("../apps/web/src/styles/motion.css", import.meta.url),
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

const readMotionCss = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(MOTION_CSS);
});

function reducedMotionBlock(source: string): string {
  const start = source.indexOf("@media (prefers-reduced-motion: reduce)");
  if (start === -1) throw new Error("no prefers-reduced-motion block");

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

it.layer(NodeServices.layer)("motion.css contract", (it) => {
  it.effect("declares the plan's exact duration ladder", () =>
    Effect.gen(function* () {
      const source = yield* readMotionCss;

      assert.include(source, "--motion-press: 100ms;");
      assert.include(source, "--motion-hover: 140ms;");
      assert.include(source, "--motion-state: 200ms;");
      assert.include(source, "--motion-layout: 240ms;");
      assert.include(source, "--motion-accent: 300ms;");
      assert.include(source, "--motion-signature: 480ms;");
    }),
  );

  it.effect("declares the plan's exact easing curves", () =>
    Effect.gen(function* () {
      const source = yield* readMotionCss;

      assert.include(source, "--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);");
      assert.include(source, "--ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);");
      assert.include(source, "--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);");
    }),
  );

  it.effect("orders the cross-portal layer roles without ties", () =>
    Effect.gen(function* () {
      const source = yield* readMotionCss;
      const roles = ["sticky-chrome", "backdrop", "modal", "dropdown", "toast", "tooltip"];
      const values = roles.map((role) =>
        Number(captureGroup(new RegExp(`--layer-${role}: (\\d+);`), source, `--layer-${role}`)),
      );

      assert.deepStrictEqual(
        values,
        [...values].sort((a, b) => a - b),
      );
      assert.strictEqual(new Set(values).size, values.length);
    }),
  );

  it.effect("gives every animating recipe a reduced-motion alternative", () =>
    Effect.gen(function* () {
      const block = reducedMotionBlock(yield* readMotionCss);

      for (const recipe of ANIMATING_RECIPES) {
        assert.include(block, `.${recipe}`, `${recipe} has no reduced-motion branch`);
      }
    }),
  );

  it.effect("preserves meaning instead of freezing animation mid-flight", () =>
    Effect.gen(function* () {
      const block = reducedMotionBlock(yield* readMotionCss);

      // A frozen keyframe reads as a stuck spinner. The one-shot recipes
      // crossfade instead, so nothing is left paused part-way through.
      assert.include(block, "motion-arrival-reduced");
      assert.include(block, "animation: none");
    }),
  );

  it.effect("keeps every glow within the plan's 6px bound", () =>
    Effect.gen(function* () {
      const source = yield* readMotionCss;
      const shadows = source.match(/box-shadow:[^;]+;/g) ?? [];
      assert.isAbove(shadows.length, 0);

      const oversized = shadows.flatMap((shadow) =>
        (shadow.match(/(\d+(?:\.\d+)?)px/g) ?? [])
          .map((length) => Number(length.replace("px", "")))
          .filter((length) => length > 6)
          .map((length) => `${length}px in "${shadow.replace(/\s+/g, " ")}"`),
      );

      assert.deepStrictEqual(oversized, []);
    }),
  );

  it.effect("keeps the press response inside Level 1 bounds", () =>
    Effect.gen(function* () {
      const source = yield* readMotionCss;
      const press = captureGroup(
        /\.motion-press:active[^{]*\{([^}]+)\}/,
        source,
        ".motion-press:active",
      );

      const translate = Number(
        captureGroup(/translateY\((\d+(?:\.\d+)?)px\)/, press, "translateY"),
      );
      assert.isAtMost(translate, 2);

      const scale = Number(captureGroup(/scale\((\d+(?:\.\d+)?)\)/, press, "scale"));
      assert.isAtLeast(scale, 0.98);
      assert.isAtMost(scale, 1.02);
    }),
  );
});
