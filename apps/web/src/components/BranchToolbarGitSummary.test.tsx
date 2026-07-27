import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { BranchToolbarGitSummary, formatBranchToolbarGitSummary } from "./BranchToolbarGitSummary";

const CLEAN_STATUS = {
  workingTree: {
    files: [],
    insertions: 0,
    deletions: 0,
  },
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
};

describe("BranchToolbarGitSummary", () => {
  it("shows compact white and astro working-tree totals plus upstream divergence", () => {
    const status = {
      ...CLEAN_STATUS,
      workingTree: {
        files: [],
        insertions: 11_012,
        deletions: 545,
      },
      aheadCount: 2,
      behindCount: 1,
    };

    const markup = renderToStaticMarkup(<BranchToolbarGitSummary status={status} />);

    expect(markup).toContain("+11k");
    expect(markup).toContain("−545");
    expect(markup).toContain("↑2");
    expect(markup).toContain("↓1");
    expect(markup).toContain("text-foreground/90");
    expect(markup).toContain("text-astro-highlight/90");
    expect(markup).toContain(
      'aria-label="Working tree: 11012 additions, 545 deletions. Upstream: 2 commits ahead, 1 behind"',
    );
  });

  it("stays hidden when the workspace and upstream are aligned", () => {
    expect(renderToStaticMarkup(<BranchToolbarGitSummary status={CLEAN_STATUS} />)).toBe("");
    expect(formatBranchToolbarGitSummary(CLEAN_STATUS)).toBeNull();
  });

  it("shows upstream divergence even when the working tree is clean", () => {
    const status = {
      ...CLEAN_STATUS,
      aheadCount: 0,
      behindCount: 3,
    };

    expect(formatBranchToolbarGitSummary(status)).toBe("Upstream: 0 commits ahead, 3 behind");
    expect(renderToStaticMarkup(<BranchToolbarGitSummary status={status} />)).toContain("↓3");
  });
});
