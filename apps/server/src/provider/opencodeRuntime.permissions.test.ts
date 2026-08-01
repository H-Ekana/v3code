import * as NodeAssert from "node:assert/strict";

import { describe, it } from "vite-plus/test";

import { buildOpenCodePermissionRules } from "./opencodeRuntime.ts";

function actionFor(
  rules: ReturnType<typeof buildOpenCodePermissionRules>,
  permission: string,
): string | undefined {
  // Named rules beat the `*` catch-all, so read the most specific match.
  return rules.find((rule) => rule.permission === permission)?.action;
}

describe("buildOpenCodePermissionRules", () => {
  it("allows everything under full access", () => {
    NodeAssert.deepEqual(buildOpenCodePermissionRules("full-access"), [
      { permission: "*", pattern: "*", action: "allow" },
    ]);
  });

  it("does not gate observe-only permissions behind an approval", () => {
    // OpenCode fires a `grep`/`glob` permission alongside the real request, so
    // asking for them turned every parallel search into its own blocking
    // approval card — the documented Supervised contract is "ask before
    // commands and file changes".
    const rules = buildOpenCodePermissionRules("approval-required");

    for (const permission of ["read", "grep", "glob", "list"]) {
      NodeAssert.equal(actionFor(rules, permission), "allow", permission);
    }
  });

  it("still asks for commands, edits and anything unrecognized", () => {
    const rules = buildOpenCodePermissionRules("approval-required");

    NodeAssert.equal(actionFor(rules, "bash"), "ask");
    NodeAssert.equal(actionFor(rules, "edit"), "ask");
    NodeAssert.equal(actionFor(rules, "external_directory"), "ask");
    // Fail closed: `permission` is an open string upstream, so a kind added by
    // a future OpenCode release must prompt rather than slip through.
    NodeAssert.equal(actionFor(rules, "*"), "ask");
  });
});
