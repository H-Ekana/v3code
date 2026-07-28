import { ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ThreadStatusLabel, ThreadWorktreeIndicator } from "./ThreadStatusIndicators";
import type { ThreadStatusPill } from "./Sidebar.logic";

describe("ThreadWorktreeIndicator", () => {
  it("renders the worktree folder and branch in an accessible label", () => {
    const markup = renderToStaticMarkup(
      <ThreadWorktreeIndicator
        thread={{
          id: ThreadId.make("thread-1"),
          branch: "feature/sidebar-indicator",
          worktreePath: "/tmp/worktrees/sidebar-indicator",
        }}
      />,
    );

    expect(markup).toContain('role="img"');
    expect(markup).toContain(
      'aria-label="Worktree: sidebar-indicator (feature/sidebar-indicator)"',
    );
    expect(markup).toContain('data-testid="thread-worktree-thread-1"');
  });

  it.each([null, "", "   "])("renders nothing for an absent worktree path", (worktreePath) => {
    const markup = renderToStaticMarkup(
      <ThreadWorktreeIndicator
        thread={{
          id: ThreadId.make("thread-1"),
          branch: "main",
          worktreePath,
        }}
      />,
    );

    expect(markup).toBe("");
  });
});

describe("ThreadStatusLabel", () => {
  const workingPill: ThreadStatusPill = {
    label: "Working",
    colorClass: "text-primary",
    dotClass: "bg-primary",
    pulse: true,
    axes: {
      activity: "running",
      attention: "none",
      outcome: "neutral",
      persistence: "active",
    },
    iconRole: "activity",
    motionClass: "motion-pending",
  };

  it("renders the running trace glyph and the label, not a bare coloured dot", () => {
    const markup = renderToStaticMarkup(<ThreadStatusLabel status={workingPill} />);

    expect(markup).toContain("thread-status-trace");
    expect(markup).toContain("Working");
    expect(markup).toContain('aria-label="Working"');
  });

  // The compact variant hides the text label, so shape has to carry the status
  // there or activity would be communicated by colour alone.
  it("keeps a glyph in the compact variant where the text label is hidden", () => {
    const markup = renderToStaticMarkup(<ThreadStatusLabel status={workingPill} compact />);

    expect(markup).toContain("thread-status-trace");
    expect(markup).toContain('aria-label="Working"');
  });

  it("applies the shared completion motion recipe to an unseen completion", () => {
    const markup = renderToStaticMarkup(
      <ThreadStatusLabel
        status={{
          label: "Completed",
          colorClass: "text-emerald-600",
          dotClass: "bg-emerald-500",
          pulse: false,
          axes: {
            activity: "complete",
            attention: "unseen-result",
            outcome: "success",
            persistence: "active",
          },
          iconRole: "check",
          motionClass: "motion-completion",
        }}
      />,
    );

    expect(markup).toContain("motion-completion");
    expect(markup).toContain("Completed");
  });
});
