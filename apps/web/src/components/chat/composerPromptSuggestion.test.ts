import { describe, expect, it } from "vite-plus/test";

import {
  type GhostAcceptInput,
  type GhostVisibilityInput,
  type PromptSuggestionTriggerInput,
  resolveVisibleGhostSuggestion,
  shouldAcceptGhostSuggestion,
  shouldRequestPromptSuggestion,
} from "./composerPromptSuggestion";

const settledEdge: PromptSuggestionTriggerInput = {
  previousPhase: "running",
  previousPhaseThreadId: "thread-a",
  phase: "ready",
  threadId: "thread-a",
  environmentId: "env-1",
  draft: "",
  approvalActive: false,
};

describe("shouldRequestPromptSuggestion", () => {
  it("fires on a running → ready edge with an empty composer", () => {
    expect(shouldRequestPromptSuggestion(settledEdge)).toBe(true);
  });

  it("fires when the turn settles into a disconnected phase", () => {
    expect(shouldRequestPromptSuggestion({ ...settledEdge, phase: "disconnected" })).toBe(true);
  });

  it("does not fire while the turn is still running", () => {
    expect(shouldRequestPromptSuggestion({ ...settledEdge, phase: "running" })).toBe(false);
  });

  it("does not fire without a running → settled edge", () => {
    expect(shouldRequestPromptSuggestion({ ...settledEdge, previousPhase: "ready" })).toBe(false);
  });

  it("does not fire when the edge belongs to a different thread", () => {
    // Regression: switching away from a running thread onto an idle one used to
    // read as a settle and burn a generation on the newly opened thread.
    expect(
      shouldRequestPromptSuggestion({
        ...settledEdge,
        previousPhaseThreadId: "thread-a",
        threadId: "thread-b",
      }),
    ).toBe(false);
  });

  it("does not fire when the composer already has a draft", () => {
    expect(shouldRequestPromptSuggestion({ ...settledEdge, draft: "wip" })).toBe(false);
    expect(shouldRequestPromptSuggestion({ ...settledEdge, draft: "   \n  " })).toBe(true);
  });

  it("does not fire while an approval owns the composer", () => {
    expect(shouldRequestPromptSuggestion({ ...settledEdge, approvalActive: true })).toBe(false);
  });

  it("does not fire without a thread or environment", () => {
    expect(
      shouldRequestPromptSuggestion({
        ...settledEdge,
        threadId: null,
        previousPhaseThreadId: null,
      }),
    ).toBe(false);
    expect(shouldRequestPromptSuggestion({ ...settledEdge, environmentId: null })).toBe(false);
  });
});

const visibleGhost: GhostVisibilityInput = {
  ghostSuggestion: "run the tests",
  draft: "",
  approvalActive: false,
  pendingProgressActive: false,
};

describe("resolveVisibleGhostSuggestion", () => {
  it("shows the ghost over an empty composer", () => {
    expect(resolveVisibleGhostSuggestion(visibleGhost)).toBe("run the tests");
  });

  it("hides the ghost while the user is typing", () => {
    expect(resolveVisibleGhostSuggestion({ ...visibleGhost, draft: "wip" })).toBeNull();
  });

  it("restores the same ghost when the draft is erased back to empty", () => {
    // The suggestion is held, not discarded — typing only hides it, so
    // accepting with Tab and then erasing brings it back for free.
    const typed = resolveVisibleGhostSuggestion({ ...visibleGhost, draft: "run the tests" });
    expect(typed).toBeNull();
    const erased = resolveVisibleGhostSuggestion({ ...visibleGhost, draft: "" });
    expect(erased).toBe("run the tests");
  });

  it("treats a whitespace-only draft as empty", () => {
    expect(resolveVisibleGhostSuggestion({ ...visibleGhost, draft: "   " })).toBe("run the tests");
  });

  it("hides behind approval and pending-question UI", () => {
    expect(resolveVisibleGhostSuggestion({ ...visibleGhost, approvalActive: true })).toBeNull();
    expect(
      resolveVisibleGhostSuggestion({ ...visibleGhost, pendingProgressActive: true }),
    ).toBeNull();
  });

  it("shows nothing when no suggestion is held", () => {
    expect(resolveVisibleGhostSuggestion({ ...visibleGhost, ghostSuggestion: null })).toBeNull();
  });
});

const tabOnGhost: GhostAcceptInput = {
  key: "Tab",
  shiftKey: false,
  menuIsActive: false,
  ghostSuggestion: "run the tests",
  draft: "",
};

describe("shouldAcceptGhostSuggestion", () => {
  it("accepts on bare Tab over an empty draft", () => {
    expect(shouldAcceptGhostSuggestion(tabOnGhost)).toBe(true);
  });

  it("never accepts on Enter — Enter only sends real draft text", () => {
    expect(shouldAcceptGhostSuggestion({ ...tabOnGhost, key: "Enter" })).toBe(false);
  });

  it("loses to Shift+Tab (interaction-mode toggle)", () => {
    expect(shouldAcceptGhostSuggestion({ ...tabOnGhost, shiftKey: true })).toBe(false);
  });

  it("loses to an open command/path menu", () => {
    expect(shouldAcceptGhostSuggestion({ ...tabOnGhost, menuIsActive: true })).toBe(false);
  });

  it("does nothing without a ghost", () => {
    expect(shouldAcceptGhostSuggestion({ ...tabOnGhost, ghostSuggestion: null })).toBe(false);
    expect(shouldAcceptGhostSuggestion({ ...tabOnGhost, ghostSuggestion: "" })).toBe(false);
  });

  it("does nothing once the user has typed", () => {
    expect(shouldAcceptGhostSuggestion({ ...tabOnGhost, draft: "already typing" })).toBe(false);
  });
});
