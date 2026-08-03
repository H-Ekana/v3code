import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";

import { decodeGitHubPullRequestListJson } from "./gitHubPullRequests.ts";

describe("decodeGitHubPullRequestListJson", () => {
  it("carries the terminal-state timestamp for merged and closed pull requests", () => {
    // Consumers date a merged/closed PR to tell a fresh outcome from history
    // (a long-lived branch keeps matching the PR it was last promoted
    // through). mergedAt wins over closedAt: a merged PR carries both, and
    // the merge is the meaningful moment.
    const decoded = decodeGitHubPullRequestListJson(
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      JSON.stringify([
        {
          number: 45,
          title: "Merged PR",
          url: "https://github.com/pingdotgg/codething-mvp/pull/45",
          baseRefName: "main",
          headRefName: "dev",
          state: "MERGED",
          mergedAt: "2026-08-01T16:43:29Z",
          closedAt: "2026-08-01T16:43:29Z",
        },
        {
          number: 46,
          title: "Closed PR",
          url: "https://github.com/pingdotgg/codething-mvp/pull/46",
          baseRefName: "main",
          headRefName: "dev",
          state: "CLOSED",
          mergedAt: null,
          closedAt: "2026-08-02T09:00:00Z",
        },
        {
          number: 47,
          title: "Open PR",
          url: "https://github.com/pingdotgg/codething-mvp/pull/47",
          baseRefName: "main",
          headRefName: "dev",
          state: "OPEN",
          mergedAt: null,
          closedAt: null,
        },
      ]),
    );

    assert.strictEqual(Result.isSuccess(decoded), true);
    if (!Result.isSuccess(decoded)) return;
    assert.deepStrictEqual(
      decoded.success.map((pullRequest) => [pullRequest.state, pullRequest.stateChangedAt]),
      [
        ["merged", "2026-08-01T16:43:29Z"],
        ["closed", "2026-08-02T09:00:00Z"],
        ["open", null],
      ],
    );
  });

  it("reports no terminal timestamp when gh omits both fields", () => {
    // gh versions that do not export closedAt must not fabricate a date; an
    // unknown timestamp keeps the pre-existing behaviour downstream.
    const decoded = decodeGitHubPullRequestListJson(
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      JSON.stringify([
        {
          number: 48,
          title: "Merged PR without timestamps",
          url: "https://github.com/pingdotgg/codething-mvp/pull/48",
          baseRefName: "main",
          headRefName: "dev",
          state: "MERGED",
        },
      ]),
    );

    assert.strictEqual(Result.isSuccess(decoded), true);
    if (!Result.isSuccess(decoded)) return;
    assert.strictEqual(decoded.success[0]?.state, "merged");
    assert.strictEqual(decoded.success[0]?.stateChangedAt, null);
  });
});
