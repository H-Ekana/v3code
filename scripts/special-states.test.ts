import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as NodeURL from "node:url";

/*
 * Contract guard for the reasoning-tier composer treatments (the "oil spill"
 * ladder) and the one over-budget glow the "Visual cleanup" slice tightened.
 *
 * Lives at repo scope for the same two reasons as `motion-recipes.test.ts`:
 * `apps/web` forbids `node:` builtins, and the unit pipeline resolves `?raw`
 * CSS imports to an empty string, so an in-package stylesheet test asserts
 * against nothing. Repo-wide lint requires the read go through Effect's
 * `FileSystem`.
 *
 * The two motion guards below encode the AMENDED rule
 * (`docs/project/nightly-motion-polish-reasoning-tiers.md`, "Test guards"):
 * continuous animation is allowed, but only under the extraordinary-state
 * `[data-reasoning-tier]` selectors; and every duration in a rule body must be a
 * named `:root` token, never a raw literal.
 */
function repoPath(relative: string): string {
  return NodeURL.fileURLToPath(new URL(relative, import.meta.url));
}

const SPECIAL_STATES_CSS = repoPath("../apps/web/src/styles/special-states.css");
const INDEX_CSS = repoPath("../apps/web/src/index.css");
const MODEL_LIST_ROW = repoPath("../apps/web/src/components/chat/ModelListRow.tsx");

function read(path: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(path);
  });
}

/** Comments cite plan bands like "150-240ms"; only code should be scanned. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The selector list opening the rule block that contains `index`. */
function selectorForIndex(source: string, index: number): string {
  const open = source.lastIndexOf("{", index);
  if (open === -1) return "";
  const prevBoundary = Math.max(source.lastIndexOf("}", open), source.lastIndexOf(";", open));
  return source.slice(prevBoundary + 1, open).trim();
}

/** Removes every `<at-rule|selector> { ... }` block whose head matches `head`. */
function stripBlocks(source: string, head: RegExp): string {
  let out = source;
  for (;;) {
    const match = head.exec(out);
    if (!match) return out;
    const open = out.indexOf("{", match.index);
    if (open === -1) return out;
    let depth = 0;
    let end = open;
    for (let i = open; i < out.length; i += 1) {
      if (out[i] === "{") depth += 1;
      if (out[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    out = out.slice(0, match.index) + out.slice(end + 1);
    head.lastIndex = 0;
  }
}

function reducedMotionBlock(source: string): string {
  const start = source.indexOf("@media (prefers-reduced-motion: reduce)");
  if (start === -1) throw new Error("no prefers-reduced-motion block");

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

/** Every `<n>px` length appearing inside a shadow-producing declaration. */
function shadowLengths(source: string): ReadonlyArray<number> {
  const declarations = [
    ...(source.match(/box-shadow:[^;]+;/g) ?? []),
    ...(source.match(/drop-shadow\([^)]*\)/g) ?? []),
  ];
  return declarations.flatMap((declaration) =>
    (declaration.match(/(\d+(?:\.\d+)?)px/g) ?? []).map((length) =>
      Number(length.replace("px", "")),
    ),
  );
}

it.layer(NodeServices.layer)("reasoning-tier special states", (it) => {
  it.effect("confines continuous animation to the extraordinary-state selectors", () =>
    Effect.gen(function* () {
      const source = stripComments(yield* read(SPECIAL_STATES_CSS));

      // Continuous animation is now allowed — these are user-selected
      // extraordinary states — but ONLY under the `[data-reasoning-tier]`
      // selectors. Every `infinite` must sit inside such a rule; none may leak
      // onto an ordinary surface.
      const infinites: Array<number> = [];
      for (let i = source.indexOf("infinite"); i !== -1; i = source.indexOf("infinite", i + 1)) {
        infinites.push(i);
      }
      assert.isAbove(infinites.length, 0, "no continuous animation found at all");
      for (const index of infinites) {
        assert.include(
          selectorForIndex(source, index),
          "data-reasoning-tier",
          "continuous animation outside the extraordinary-state selectors",
        );
      }

      // `filter` animation and hue rotation stay banned everywhere (cost band).
      assert.notMatch(source, /hue-rotate/);
    }),
  );

  it.effect("declares animation-parameterised gradients on the pseudo that animates them", () =>
    Effect.gen(function* () {
      const source = stripComments(yield* read(SPECIAL_STATES_CSS));

      // Amendment 6.1 regression lock. `--reasoning-rim-cups` / the cup-centre
      // token contain var() references to registered properties that ANIMATE on
      // the `::before` pseudo. A custom property substitutes its var()s on the
      // element that DECLARES it, so declaring these on the frame bakes in the
      // frame's static 0% reach/bloom — the cups and the max ring paint fully
      // transparent (the "Extra High and Max show nothing" defect). They must
      // be declared under a `::before` selector.
      for (const token of ["--reasoning-rim-cups:", "--reasoning-cup-center:"]) {
        const declaration = source.indexOf(token);
        assert.isAbove(declaration, -1, `${token} is no longer declared`);
        assert.include(
          selectorForIndex(source, declaration),
          "::before",
          `${token} must be declared on the ::before pseudo that animates its inputs`,
        );
      }

      // The pour's border-contact/ripple radius must stay parameterised by the
      // measured covering radius, with a percentage default for the unmeasured
      // first paint (ChatComposer overrides it in px on flood entry).
      assert.include(source, "--spread-cover-r: 121%");
      assert.include(source, "var(--spread-cover-r)");

      // The ultrathink ring wrap starts on its own near-immediate token, never
      // gated on the pour; the ultracode streak has its own late, slow fade-in.
      assert.include(source, "--reasoning-ring-start:");
      assert.include(source, "--reasoning-streak-start: calc(");
      assert.include(source, "var(--reasoning-streak-fade)");
      assert.match(
        source,
        /reasoning-ring-build\)\s+var\(--ease-out-sine\)\s+var\(--reasoning-ring-start\)/,
      );
    }),
  );

  it.effect("keeps the text solid rather than gradient-filled", () =>
    Effect.gen(function* () {
      const source = yield* read(SPECIAL_STATES_CSS);

      // Amendment 6.10: exactly ONE rainbow survivor — the thinking-level pill
      // label under ultrathink. Every gradient-clip / transparent-ink
      // declaration must sit inside that selector; everything else stays solid.
      const stripped = stripComments(source);
      for (const marker of [/background-clip:\s*text/g, /(?<=[\s;{])color:\s*transparent/g]) {
        const matches = [...stripped.matchAll(marker)];
        assert.isAbove(matches.length, 0, `${marker} not found at all`);
        for (const match of matches) {
          const selector = selectorForIndex(stripped, match.index ?? 0);
          assert.include(selector, 'data-reasoning-tier="ultrathink"');
          assert.include(
            selector,
            "data-composer-reasoning-origin",
            "rainbow ink is confined to the thinking-level pill label",
          );
        }
      }
    }),
  );

  it.effect("routes every rule-body duration through a named :root token", () =>
    Effect.gen(function* () {
      const source = stripComments(yield* read(SPECIAL_STATES_CSS));

      // The entry sweep stays in Plan "Intensity ladder" Level 2 — 150-240ms.
      const entry = /--reasoning-entry-sweep:\s*(\d+)ms;/.exec(source);
      assert.isNotNull(entry, "--reasoning-entry-sweep is not declared");
      const entryMs = Number(entry?.[1]);
      assert.isAtLeast(entryMs, 150);
      assert.isAtMost(entryMs, 240);

      // Every duration lives in `:root` as a named token; no raw time literal
      // may appear in a rule body. Strip the token declarations (`:root`) and
      // the registered-angle block (`@property`), then assert nothing timed is
      // left — animations reference the tokens via `var()`.
      const withoutTokens = stripBlocks(stripBlocks(source, /:root\s*/g), /@property[^{]*/g);
      assert.deepStrictEqual(
        withoutTokens.match(/\b\d+(?:\.\d+)?\s*m?s\b/g),
        null,
        "a raw duration literal leaked into a rule body",
      );

      // The token list is free to grow, but every one it declares must be a
      // time value, and each must actually be consumed via `var()`.
      const tokens = [...source.matchAll(/(--reasoning-[a-z-]+):\s*[\d.]+m?s;/g)].map(
        (match) => match[1] ?? "",
      );
      assert.isAtLeast(tokens.length, 1);
      for (const token of tokens) {
        assert.include(source, `var(${token})`, `${token} is declared but never used`);
      }

      // Easing comes from the shared language, never a local curve.
      assert.include(source, "var(--ease-out-quart)");
      assert.notMatch(source, /cubic-bezier/);
    }),
  );

  it.effect("omits the entry sweep under reduced motion but keeps the rim", () =>
    Effect.gen(function* () {
      const source = yield* read(SPECIAL_STATES_CSS);
      const block = reducedMotionBlock(source);

      // The renamed carry-over of the former `.ultrathink-frame::before` rule:
      // the one-shot entry sweep is disabled, the static rim/glyph are not.
      assert.include(block, "[data-reasoning-tier=");
      assert.include(block, "::after");
      assert.include(block, "animation: none");
      assert.notInclude(block, "--reasoning-rim");
      assert.notInclude(block, ".ultrathink-chroma");
    }),
  );

  it.effect("keeps the resting glow inside the ordinary-effect budget", () =>
    Effect.gen(function* () {
      const source = yield* read(SPECIAL_STATES_CSS);
      const lengths = shadowLengths(source);

      assert.isAbove(lengths.length, 0);
      // Plan "Visual cleanup": ordinary effects stay within 3-4px.
      assert.deepStrictEqual(
        lengths.filter((length) => length > 4),
        [],
      );
    }),
  );

  it.effect("is the only home for ultrathink styling", () =>
    Effect.gen(function* () {
      const indexCss = yield* read(INDEX_CSS);

      assert.include(indexCss, '@import "./styles/special-states.css";');
      // The rainbow keyframes, the gradient-text word, and the hue-rotating
      // glyph must not survive anywhere in the shared stylesheet.
      assert.notMatch(indexCss, /ultrathink-rainbow|ultrathink-chroma-shift/);
      assert.notMatch(indexCss, /\.ultrathink-(frame|chroma|pill|word)\b/);
    }),
  );
});

it.layer(NodeServices.layer)("model picker selected-row glow", (it) => {
  it.effect("stays inside the plan's 3-4px ordinary-effect budget", () =>
    Effect.gen(function* () {
      const source = yield* read(MODEL_LIST_ROW);

      const shadows = source.match(/shadow-\[[^\]]+\]/g) ?? [];
      assert.isAbove(shadows.length, 0, "no arbitrary shadow utilities found");

      const oversized = shadows.flatMap((shadow) =>
        (shadow.match(/(\d+(?:\.\d+)?)px/g) ?? [])
          .map((length) => Number(length.replace("px", "")))
          .filter((length) => length > 4)
          .map((length) => `${length}px in "${shadow}"`),
      );

      assert.deepStrictEqual(oversized, []);
    }),
  );
});
