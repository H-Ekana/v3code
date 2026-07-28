/*
 * Reports the splash parting schedule and asserts the invariant that keeps the composer's
 * glass intact: nothing on the path to it may carry a partial opacity.
 *
 * Per the Filter Effects spec an element with opacity < 1 is a Backdrop Root for its
 * descendants. The composer's glass is a backdrop-filter on its ::before, so a fade on
 * #root, on the workspace, or on the composer itself makes that glass sample an empty
 * backdrop and render flat — then snap to its real saturated appearance when the fade ends.
 * Everything on this path therefore arrives by transform only.
 *
 * Run: node scripts/check-splash-order.mjs
 */
import { readFileSync } from "node:fs";

const html = readFileSync("apps/web/index.html", "utf8");

const PATH_TO_GLASS = [
  { label: "#root", selector: "#root" },
  { label: "sidebar-inset", selector: '\\[data-slot="sidebar-inset"\\]' },
  { label: "composer", selector: "\\[data-startup-composer-target\\]" },
];

let failed = false;

for (const { label, selector } of PATH_TO_GLASS) {
  const block = new RegExp(
    `\\[data-startup-splash="exiting"\\] ${selector} \\{[\\s\\S]*?\\n      \\}`,
  ).exec(html)?.[0];

  if (!block) {
    console.error(`${label.padEnd(15)} NO RULE FOUND — any check here would be vacuous`);
    failed = true;
    continue;
  }

  const partialOpacity = /opacity:\s*0?\.\d/.exec(block)?.[0];
  const animatesOpacity = /fade|opacity/.test(block.replace(/opacity:\s*1;/, ""));
  const animation = /animation:\s*([^;]+);/.exec(block)?.[1]?.replace(/\s+/g, " ").trim();

  console.log(`${label.padEnd(15)} ${animation ?? "(no animation)"}`);
  if (partialOpacity) {
    console.error(`${" ".repeat(15)} FAIL: partial opacity "${partialOpacity}"`);
    failed = true;
  } else if (animatesOpacity) {
    console.error(`${" ".repeat(15)} FAIL: rule still references opacity`);
    failed = true;
  }
}

// Keyframes on this path must not touch opacity either.
for (const name of ["composer-rise", "workspace-rise"]) {
  const frames = new RegExp(`@keyframes v3-startup-${name} \\{[^@]*?\\n      \\}`, "s").exec(
    html,
  )?.[0];
  if (!frames) {
    console.error(`@keyframes v3-startup-${name}: MISSING`);
    failed = true;
  } else if (frames.includes("opacity")) {
    console.error(`@keyframes v3-startup-${name}: FAIL: animates opacity`);
    failed = true;
  }
}

console.log(
  failed
    ? "\nFAIL — the composer's glass will render flat and then snap."
    : "\nOK — transform only on the path to the glass; no backdrop-root snap possible.",
);
process.exit(failed ? 1 : 0);
