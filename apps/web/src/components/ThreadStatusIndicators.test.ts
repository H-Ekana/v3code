import type { VcsStatusResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  prStatusIndicator,
  resolveThreadPr,
  settledPrHoverColorClass,
} from "./ThreadStatusIndicators";

function status(overrides: Partial<VcsStatusResult> = {}): VcsStatusResult {
  return {
    isRepo: true,
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: "feature/current",
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: {
      number: 42,
      title: "PR branch",
      url: "https://github.com/pingdotgg/t3code/pull/42",
      baseRef: "main",
      headRef: "feature/current",
      state: "open",
    },
    ...overrides,
  };
}

describe("resolveThreadPr", () => {
  it("keeps local-checkout PR indicators scoped to the stored thread branch", () => {
    expect(
      resolveThreadPr({
        threadBranch: "feature/other",
        gitStatus: status(),
      }),
    ).toBeNull();
  });

  it("hides PR indicators when a dedicated worktree has switched away from the thread branch", () => {
    expect(
      resolveThreadPr({
        threadBranch: "stack/base",
        gitStatus: status(),
      }),
    ).toBeNull();
  });

  it("hides PR indicators when thread branch metadata is missing", () => {
    expect(
      resolveThreadPr({
        threadBranch: null,
        gitStatus: status(),
      }),
    ).toBeNull();
  });

  it("shows the PR when the live checkout matches the stored thread branch", () => {
    const gitStatus = status();

    expect(
      resolveThreadPr({
        threadBranch: "feature/current",
        gitStatus,
      }),
    ).toBe(gitStatus.pr);
  });

  it("hides a change request that already closed before the thread existed", () => {
    // A long-lived branch keeps matching the PR it was promoted through. A
    // thread opened afterwards never touched that work, so the branch's PR is
    // not its PR — sharing a branch name is not identity.
    const gitStatus = status({
      refName: "dev",
      pr: {
        number: 45,
        title: "release: promote dev",
        url: "https://github.com/pingdotgg/t3code/pull/45",
        baseRef: "main",
        headRef: "dev",
        state: "merged",
        stateChangedAt: "2026-08-01T16:43:29.000Z",
      },
    });

    expect(
      resolveThreadPr({
        threadBranch: "dev",
        threadCreatedAt: "2026-08-03T09:00:00.000Z",
        gitStatus,
      }),
    ).toBeNull();
  });

  it("keeps a change request that merged while the thread was alive", () => {
    // The thread that did the work still gets its "merged" badge, however
    // long ago that was — recency is not what makes the PR relevant.
    const gitStatus = status({
      refName: "dev",
      pr: {
        number: 45,
        title: "release: promote dev",
        url: "https://github.com/pingdotgg/t3code/pull/45",
        baseRef: "main",
        headRef: "dev",
        state: "merged",
        stateChangedAt: "2026-08-01T16:43:29.000Z",
      },
    });

    expect(
      resolveThreadPr({
        threadBranch: "dev",
        threadCreatedAt: "2026-07-28T09:00:00.000Z",
        gitStatus,
      }),
    ).toBe(gitStatus.pr);
  });

  it("keeps an open change request regardless of when the thread started", () => {
    // Work happening on the branch now is work on its open change request.
    const gitStatus = status({ refName: "dev", pr: { ...status().pr!, headRef: "dev" } });

    expect(
      resolveThreadPr({
        threadBranch: "dev",
        threadCreatedAt: "2026-08-03T09:00:00.000Z",
        gitStatus,
      }),
    ).toBe(gitStatus.pr);
  });

  it("keeps the PR when the outcome time is unknown", () => {
    // Older servers do not report one; do not drop a badge we cannot order.
    const gitStatus = status({
      refName: "dev",
      pr: {
        number: 45,
        title: "release: promote dev",
        url: "https://github.com/pingdotgg/t3code/pull/45",
        baseRef: "main",
        headRef: "dev",
        state: "merged",
      },
    });

    expect(
      resolveThreadPr({
        threadBranch: "dev",
        threadCreatedAt: "2026-08-03T09:00:00.000Z",
        gitStatus,
      }),
    ).toBe(gitStatus.pr);
  });
});

describe("prStatusIndicator", () => {
  it("formats PR tooltips with number, uppercase status, and title", () => {
    expect(prStatusIndicator(status().pr, undefined)).toMatchObject({
      tooltip: "PR #42 - Open: PR branch",
      tooltipLead: "PR #42 - Open",
      tooltipTitle: "PR branch",
    });
  });

  it("uses red for closed pull requests", () => {
    const closedPr = status().pr;
    if (!closedPr) throw new Error("Expected pull request fixture");

    expect(prStatusIndicator({ ...closedPr, state: "closed" }, undefined)?.colorClass).toContain(
      "text-red-600",
    );
  });
});

describe("settledPrHoverColorClass", () => {
  it.each([
    ["open", "text-emerald-600"],
    ["merged", "text-violet-600"],
    ["closed", "text-red-600"],
  ] as const)("restores the %s pull request color on row hover", (state, colorClass) => {
    expect(settledPrHoverColorClass(state)).toContain(`group-hover/v2-row:${colorClass}`);
  });
});
