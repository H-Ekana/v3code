import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  applyManualThreadOrder,
  archiveSelectedThreadEntries,
  buildBulkTitleRegenerationContextMenuItem,
  buildMultiSelectThreadContextMenuItems,
  moveThreadInManualOrder,
  createThreadJumpHintVisibilityController,
  getSidebarThreadIdsToPrewarm,
  getVisibleSidebarThreadIds,
  resolveAdjacentThreadId,
  getFallbackThreadIdAfterDelete,
  getVisibleThreadsForProject,
  getProjectSortTimestamp,
  hasUnseenCompletion,
  isContextMenuPointerDown,
  isTrailingDoubleClick,
  orderItemsByPreferredIds,
  resolveProjectStatusIndicator,
  resolveSidebarStageBadgeLabel,
  resolveSidebarV2RowSurfaceClassName,
  resolveThreadRowClassName,
  resolveSidebarV2Status,
  SIDEBAR_AGENTS_STALE_AFTER_MS,
  resolveThreadStatusPill,
  resolveWorkingStartedAt,
  searchSidebarThreadsByTitle,
  formatWorkingDurationLabel,
  shouldNavigateAfterProjectRemoval,
  shouldClearThreadSelectionOnMouseDown,
  sortLogicalProjectsForSidebar,
  sortSettledThreadsForSidebarV2,
  sortThreadsForSidebarV2,
  sortProjectsForSidebar,
  sortScopedProjectsForSidebar,
  THREAD_JUMP_HINT_SHOW_DELAY_MS,
  beginThreadSettle,
  clearThreadSettleMark,
  releaseThreadSettleHold,
  resolveThreadSettle,
  threadSettlePhase,
  EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT,
  type ThreadStatusPill,
} from "./Sidebar.logic";
import {
  EnvironmentId,
  OrchestrationLatestTurn,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";

import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type Project,
  type Thread,
} from "../types";

const localEnvironmentId = EnvironmentId.make("environment-local");

describe("shouldNavigateAfterProjectRemoval", () => {
  const projectThreads = [{ environmentId: "environment-local", id: "thread-1" }];

  it("navigates away from a draft route owned by the removed project", () => {
    expect(
      shouldNavigateAfterProjectRemoval({
        routeTarget: { kind: "draft", draftId: "draft-1" as never },
        projectThreads,
        projectDraftId: "draft-1",
      }),
    ).toBe(true);
  });

  it("does not navigate away from a different draft route", () => {
    expect(
      shouldNavigateAfterProjectRemoval({
        routeTarget: { kind: "draft", draftId: "draft-2" as never },
        projectThreads,
        projectDraftId: "draft-1",
      }),
    ).toBe(false);
  });

  it("navigates away from a server thread owned by the removed project", () => {
    expect(
      shouldNavigateAfterProjectRemoval({
        routeTarget: {
          kind: "server",
          threadRef: {
            environmentId: EnvironmentId.make("environment-local"),
            threadId: ThreadId.make("thread-1"),
          },
        },
        projectThreads,
        projectDraftId: null,
      }),
    ).toBe(true);
  });

  it("does not navigate from an unrelated route", () => {
    expect(
      shouldNavigateAfterProjectRemoval({
        routeTarget: null,
        projectThreads,
        projectDraftId: null,
      }),
    ).toBe(false);
  });
});

describe("archiveSelectedThreadEntries", () => {
  const entries = [{ threadKey: "one" }, { threadKey: "two" }, { threadKey: "three" }] as const;
  const success = { _tag: "Success" } as const;
  const failure = { _tag: "Failure" } as const;

  it("records every entry after full success", async () => {
    const outcome = await archiveSelectedThreadEntries({
      entries,
      archive: async (_entry, onArchived) => {
        onArchived();
        return success;
      },
    });

    expect(outcome).toEqual({
      archivedThreadKeys: ["one", "two", "three"],
      mutationFailure: null,
      followupFailures: [],
    });
  });

  it("stops at a mutation failure and retains prior successes", async () => {
    const archive = vi.fn(async (entry: (typeof entries)[number], onArchived: () => void) => {
      if (entry.threadKey === "two") return failure;
      onArchived();
      return success;
    });
    const outcome = await archiveSelectedThreadEntries({ entries, archive });

    expect(archive).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({
      archivedThreadKeys: ["one"],
      mutationFailure: failure,
      followupFailures: [],
    });
  });

  it("continues after a post-archive failure", async () => {
    const archive = vi.fn(async (entry: (typeof entries)[number], onArchived: () => void) => {
      onArchived();
      return entry.threadKey === "two" ? failure : success;
    });
    const outcome = await archiveSelectedThreadEntries({ entries, archive });

    expect(archive).toHaveBeenCalledTimes(3);
    expect(outcome).toEqual({
      archivedThreadKeys: ["one", "two", "three"],
      mutationFailure: null,
      followupFailures: [failure],
    });
  });
});

describe("buildBulkTitleRegenerationContextMenuItem", () => {
  it("counts only threads that can start a new regeneration", () => {
    expect(
      buildBulkTitleRegenerationContextMenuItem({
        supportedCount: 4,
        actionableCount: 3,
      }),
    ).toEqual({
      id: "regenerate-title",
      label: "Regenerate titles (3)",
    });
  });

  it("shows a disabled progress item when every supported thread is pending", () => {
    expect(
      buildBulkTitleRegenerationContextMenuItem({
        supportedCount: 2,
        actionableCount: 0,
      }),
    ).toEqual({
      id: "regenerate-title",
      label: "Regenerating… (2)",
      disabled: true,
    });
  });

  it("omits the action when no selected environment supports it", () => {
    expect(
      buildBulkTitleRegenerationContextMenuItem({
        supportedCount: 0,
        actionableCount: 0,
      }),
    ).toBeNull();
  });
});

describe("buildMultiSelectThreadContextMenuItems", () => {
  it("offers bulk archive with the selected count", () => {
    expect(
      buildMultiSelectThreadContextMenuItems({ count: 3, hasRunningThread: false }),
    ).toContainEqual({ id: "archive", label: "Archive (3)", disabled: false });
  });

  it("disables bulk archive when a selected thread is running", () => {
    expect(
      buildMultiSelectThreadContextMenuItems({ count: 2, hasRunningThread: true }),
    ).toContainEqual({ id: "archive", label: "Archive (2)", disabled: true });
  });
});

describe("resolveSidebarStageBadgeLabel", () => {
  it("returns Nightly for nightly primary server versions", () => {
    expect(
      resolveSidebarStageBadgeLabel({
        primaryServerVersion: "0.0.28-nightly.20260616.12",
        fallbackStageLabel: "Alpha",
      }),
    ).toBe("Nightly");
  });

  it("returns the fallback label for stable primary server versions", () => {
    expect(
      resolveSidebarStageBadgeLabel({
        primaryServerVersion: "0.0.27",
        fallbackStageLabel: "Alpha",
      }),
    ).toBe("Alpha");
  });

  it("returns the fallback label when the primary server version is missing", () => {
    expect(
      resolveSidebarStageBadgeLabel({
        primaryServerVersion: null,
        fallbackStageLabel: "Dev",
      }),
    ).toBe("Dev");
  });

  it("returns the fallback label for malformed nightly prerelease versions", () => {
    expect(
      resolveSidebarStageBadgeLabel({
        primaryServerVersion: "0.0.28-nightly.20260616",
        fallbackStageLabel: "Alpha",
      }),
    ).toBe("Alpha");
  });
});

function makeLatestTurn(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): OrchestrationLatestTurn {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt:
      overrides?.startedAt !== undefined ? overrides.startedAt : "2026-03-09T10:00:00.000Z",
    completedAt:
      overrides?.completedAt !== undefined ? overrides.completedAt : "2026-03-09T10:05:00.000Z",
  };
}

describe("hasUnseenCompletion", () => {
  it("returns true when a thread completed after its last visit", () => {
    expect(
      hasUnseenCompletion({
        hasActionableProposedPlan: false,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        interactionMode: "default",
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:04:00.000Z",
        session: null,
      }),
    ).toBe(true);
  });

  it("treats a missing client visit marker as read", () => {
    expect(
      hasUnseenCompletion({
        hasActionableProposedPlan: false,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        interactionMode: "default",
        latestTurn: makeLatestTurn(),
        lastVisitedAt: undefined,
        session: null,
      }),
    ).toBe(false);
  });
});

describe("createThreadJumpHintVisibilityController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays showing jump hints until the configured delay elapses", () => {
    const visibilityChanges: boolean[] = [];
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        visibilityChanges.push(visible);
      },
    });

    controller.sync(true);
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS - 1);

    expect(visibilityChanges).toEqual([]);

    vi.advanceTimersByTime(1);

    expect(visibilityChanges).toEqual([true]);
  });

  it("hides immediately when the modifiers are released", () => {
    const visibilityChanges: boolean[] = [];
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        visibilityChanges.push(visible);
      },
    });

    controller.sync(true);
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);
    controller.sync(false);

    expect(visibilityChanges).toEqual([true, false]);
  });

  it("cancels a pending reveal when the modifier is released early", () => {
    const visibilityChanges: boolean[] = [];
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        visibilityChanges.push(visible);
      },
    });

    controller.sync(true);
    vi.advanceTimersByTime(Math.floor(THREAD_JUMP_HINT_SHOW_DELAY_MS / 2));
    controller.sync(false);
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);

    expect(visibilityChanges).toEqual([]);
  });
});

describe("getSidebarThreadIdsToPrewarm", () => {
  it("returns only the first visible thread ids up to the prewarm limit", () => {
    expect(getSidebarThreadIdsToPrewarm(["t1", "t2", "t3"], 2)).toEqual(["t1", "t2"]);
  });

  it("returns all visible thread ids when they fit within the limit", () => {
    expect(getSidebarThreadIdsToPrewarm(["t1", "t2"], 10)).toEqual(["t1", "t2"]);
  });

  it("returns no thread ids when the limit is zero", () => {
    expect(getSidebarThreadIdsToPrewarm(["t1", "t2"], 0)).toEqual([]);
  });
});

describe("shouldClearThreadSelectionOnMouseDown", () => {
  it("preserves selection for thread items", () => {
    const child = {
      closest: (selector: string) =>
        selector.includes("[data-thread-item]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(child)).toBe(false);
  });

  it("preserves selection for thread list toggle controls", () => {
    const selectionSafe = {
      closest: (selector: string) =>
        selector.includes("[data-thread-selection-safe]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(selectionSafe)).toBe(false);
  });

  it("clears selection for unrelated sidebar clicks", () => {
    const unrelated = {
      closest: () => null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(unrelated)).toBe(true);
  });
});

describe("isTrailingDoubleClick", () => {
  it("treats a single click as a normal activation", () => {
    expect(isTrailingDoubleClick(1)).toBe(false);
  });

  it("treats synthetic/keyboard activations (detail 0) as a normal activation", () => {
    expect(isTrailingDoubleClick(0)).toBe(false);
  });

  it("ignores the second click of a double-click so it does not navigate", () => {
    expect(isTrailingDoubleClick(2)).toBe(true);
  });

  it("ignores further clicks of a triple-click", () => {
    expect(isTrailingDoubleClick(3)).toBe(true);
  });
});

describe("orderItemsByPreferredIds", () => {
  it("keeps preferred ids first, skips stale ids, and preserves the relative order of remaining items", () => {
    const ordered = orderItemsByPreferredIds({
      items: [
        { id: ProjectId.make("project-1"), name: "One" },
        { id: ProjectId.make("project-2"), name: "Two" },
        { id: ProjectId.make("project-3"), name: "Three" },
      ],
      preferredIds: [
        ProjectId.make("project-3"),
        ProjectId.make("project-missing"),
        ProjectId.make("project-1"),
      ],
      getId: (project) => project.id,
    });

    expect(ordered.map((project) => project.id)).toEqual([
      ProjectId.make("project-3"),
      ProjectId.make("project-1"),
      ProjectId.make("project-2"),
    ]);
  });

  it("does not duplicate items when preferred ids repeat", () => {
    const ordered = orderItemsByPreferredIds({
      items: [
        { id: ProjectId.make("project-1"), name: "One" },
        { id: ProjectId.make("project-2"), name: "Two" },
      ],
      preferredIds: [
        ProjectId.make("project-2"),
        ProjectId.make("project-1"),
        ProjectId.make("project-2"),
      ],
      getId: (project) => project.id,
    });

    expect(ordered.map((project) => project.id)).toEqual([
      ProjectId.make("project-2"),
      ProjectId.make("project-1"),
    ]);
  });

  it("honors projectOrder physical keys via getProjectOrderKey", async () => {
    // Regression guard for #1904 / the regression introduced by #2055:
    // `projectOrder` is populated with physical keys (envId + cwd-derived)
    // by the store and by drag-end handlers. Readers must identify projects
    // with the same key format, or manual sort silently snaps back.
    const { getProjectOrderKey } = await import("../logicalProject");
    const projects = [
      {
        environmentId: EnvironmentId.make("environment-local"),
        id: ProjectId.make("id-alpha"),
        workspaceRoot: "/work/alpha",
      },
      {
        environmentId: EnvironmentId.make("environment-local"),
        id: ProjectId.make("id-beta"),
        workspaceRoot: "/work/beta",
      },
      {
        environmentId: EnvironmentId.make("environment-local"),
        id: ProjectId.make("id-gamma"),
        workspaceRoot: "/work/gamma",
      },
    ];
    const ordered = orderItemsByPreferredIds({
      items: projects,
      preferredIds: [getProjectOrderKey(projects[2]!), getProjectOrderKey(projects[0]!)],
      getId: getProjectOrderKey,
    });

    expect(ordered.map((project) => project.workspaceRoot)).toEqual([
      "/work/gamma",
      "/work/alpha",
      "/work/beta",
    ]);
  });

  it("resolves legacy preference aliases without materializing project state", () => {
    const ordered = orderItemsByPreferredIds({
      items: [
        { id: "physical-a", cwd: "/work/a" },
        { id: "physical-b", cwd: "/work/b" },
        { id: "physical-c", cwd: "/work/c" },
      ],
      preferredIds: ["legacy:/work/c", "legacy:/work/a"],
      getId: (project) => project.id,
      getPreferenceIds: (project) => [project.id, `legacy:${project.cwd}`],
    });

    expect(ordered.map((project) => project.id)).toEqual([
      "physical-c",
      "physical-a",
      "physical-b",
    ]);
  });
});

describe("resolveAdjacentThreadId", () => {
  it("resolves adjacent thread ids in ordered sidebar traversal", () => {
    const threads = [
      ThreadId.make("thread-1"),
      ThreadId.make("thread-2"),
      ThreadId.make("thread-3"),
    ];

    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[1] ?? null,
        direction: "previous",
      }),
    ).toBe(threads[0]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[1] ?? null,
        direction: "next",
      }),
    ).toBe(threads[2]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: null,
        direction: "next",
      }),
    ).toBe(threads[0]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: null,
        direction: "previous",
      }),
    ).toBe(threads[2]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[0] ?? null,
        direction: "previous",
      }),
    ).toBeNull();
  });
});

describe("getVisibleSidebarThreadIds", () => {
  it("returns only the rendered visible thread order across projects", () => {
    expect(
      getVisibleSidebarThreadIds([
        {
          renderedThreadIds: [
            ThreadId.make("thread-12"),
            ThreadId.make("thread-11"),
            ThreadId.make("thread-10"),
          ],
        },
        {
          renderedThreadIds: [ThreadId.make("thread-8"), ThreadId.make("thread-6")],
        },
      ]),
    ).toEqual([
      ThreadId.make("thread-12"),
      ThreadId.make("thread-11"),
      ThreadId.make("thread-10"),
      ThreadId.make("thread-8"),
      ThreadId.make("thread-6"),
    ]);
  });

  it("skips threads from collapsed projects whose thread panels are not shown", () => {
    expect(
      getVisibleSidebarThreadIds([
        {
          shouldShowThreadPanel: false,
          renderedThreadIds: [ThreadId.make("thread-hidden-2"), ThreadId.make("thread-hidden-1")],
        },
        {
          shouldShowThreadPanel: true,
          renderedThreadIds: [ThreadId.make("thread-12"), ThreadId.make("thread-11")],
        },
      ]),
    ).toEqual([ThreadId.make("thread-12"), ThreadId.make("thread-11")]);
  });
});

describe("isContextMenuPointerDown", () => {
  it("treats secondary-button presses as context menu gestures on all platforms", () => {
    expect(
      isContextMenuPointerDown({
        button: 2,
        ctrlKey: false,
        isMac: false,
      }),
    ).toBe(true);
  });

  it("treats ctrl+primary-click as a context menu gesture on macOS", () => {
    expect(
      isContextMenuPointerDown({
        button: 0,
        ctrlKey: true,
        isMac: true,
      }),
    ).toBe(true);
  });

  it("does not treat ctrl+primary-click as a context menu gesture off macOS", () => {
    expect(
      isContextMenuPointerDown({
        button: 0,
        ctrlKey: true,
        isMac: false,
      }),
    ).toBe(false);
  });
});

describe("resolveSidebarV2Status", () => {
  const session = {
    threadId: ThreadId.make("thread-1"),
    status: "running" as const,
    providerName: "Codex",
    providerInstanceId: ProviderInstanceId.make("codex"),
    runtimeMode: DEFAULT_RUNTIME_MODE,
    activeTurnId: "turn-1" as never,
    lastError: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
  };

  const idle = {
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    activeAgentCount: 0,
    activeBackgroundTaskCount: 0,
    agentsLastActivityAt: null,
  };

  // Fixed clock so the staleness cutoff is exercised deterministically.
  const now = Date.parse("2026-03-09T10:00:00.000Z");
  const agentsAt = (msAgo: number) => new Date(now - msAgo).toISOString();
  const settled = { ...session, status: "ready" as const, activeTurnId: null as never };

  it("prioritizes approval over a running session", () => {
    expect(resolveSidebarV2Status({ ...idle, hasPendingApprovals: true, session })).toBe(
      "approval",
    );
  });

  it("prioritizes awaiting input over a running session, below approval", () => {
    expect(resolveSidebarV2Status({ ...idle, hasPendingUserInput: true, session })).toBe("input");
    expect(
      resolveSidebarV2Status({
        ...idle,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
        session,
      }),
    ).toBe("approval");
  });

  it("reports working for running and starting sessions", () => {
    expect(resolveSidebarV2Status({ ...idle, session })).toBe("working");
    expect(
      resolveSidebarV2Status({
        ...idle,
        session: { ...session, status: "starting" as const },
      }),
    ).toBe("working");
  });

  it("reports failed only while the session status is error", () => {
    expect(
      resolveSidebarV2Status({
        ...idle,
        session: { ...session, status: "error" as const, lastError: "boom" },
      }),
    ).toBe("failed");
    expect(
      resolveSidebarV2Status({
        ...idle,
        session: { ...session, status: "stopped" as const, lastError: "persisted" },
      }),
    ).toBe("ready");
    expect(
      resolveSidebarV2Status({
        ...idle,
        session: { ...session, status: "ready" as const, lastError: "persisted" },
      }),
    ).toBe("ready");
  });

  it("defaults to ready with no session", () => {
    expect(resolveSidebarV2Status({ ...idle, session: null })).toBe("ready");
  });

  it("reports agents when the session settled but subagents are still live", () => {
    expect(
      resolveSidebarV2Status(
        {
          ...idle,
          session: settled,
          activeAgentCount: 3,
          agentsLastActivityAt: agentsAt(60_000),
        },
        now,
      ),
    ).toBe("agents");
  });

  it("reports agents when the only live work is a background task", () => {
    // A build watcher or monitor keeps the thread producing after the main
    // turn settles; the badge label distinguishes it from agents, the status
    // does not.
    expect(
      resolveSidebarV2Status(
        {
          ...idle,
          session: settled,
          activeBackgroundTaskCount: 1,
          agentsLastActivityAt: agentsAt(60_000),
        },
        now,
      ),
    ).toBe("agents");
  });

  it("ranks a running session above live subagents", () => {
    // The main loop working is the stronger signal; subagents under it are
    // implied rather than newsworthy.
    expect(
      resolveSidebarV2Status(
        { ...idle, session, activeAgentCount: 2, agentsLastActivityAt: agentsAt(1_000) },
        now,
      ),
    ).toBe("working");
  });

  it("ranks approval, input, and failure above live subagents", () => {
    const live = { activeAgentCount: 2, agentsLastActivityAt: agentsAt(1_000) };
    expect(
      resolveSidebarV2Status(
        { ...idle, ...live, session: settled, hasPendingApprovals: true },
        now,
      ),
    ).toBe("approval");
    expect(
      resolveSidebarV2Status(
        { ...idle, ...live, session: settled, hasPendingUserInput: true },
        now,
      ),
    ).toBe("input");
    expect(
      resolveSidebarV2Status(
        { ...idle, ...live, session: { ...session, status: "error" as const, lastError: "boom" } },
        now,
      ),
    ).toBe("failed");
  });

  it("ages out a roster that stopped reporting", () => {
    // A server that dies mid-run leaves its agents replaying as running
    // forever; without the cutoff the thread could never show Done again.
    expect(
      resolveSidebarV2Status(
        {
          ...idle,
          session: settled,
          activeAgentCount: 3,
          agentsLastActivityAt: agentsAt(SIDEBAR_AGENTS_STALE_AFTER_MS + 1_000),
        },
        now,
      ),
    ).toBe("ready");
  });

  it("treats an untimestamped or unparseable roster as stale", () => {
    expect(
      resolveSidebarV2Status(
        { ...idle, session: settled, activeAgentCount: 3, agentsLastActivityAt: null },
        now,
      ),
    ).toBe("ready");
    expect(
      resolveSidebarV2Status(
        { ...idle, session: settled, activeAgentCount: 3, agentsLastActivityAt: "not-a-date" },
        now,
      ),
    ).toBe("ready");
  });

  it("stays ready when the roster has no active agents", () => {
    expect(
      resolveSidebarV2Status(
        {
          ...idle,
          session: settled,
          activeAgentCount: 0,
          activeBackgroundTaskCount: 0,
          agentsLastActivityAt: agentsAt(1_000),
        },
        now,
      ),
    ).toBe("ready");
  });
});

describe("searchSidebarThreadsByTitle", () => {
  const threads = [
    { id: "thread-1", title: "Fix workspace search", project: "Alpha" },
    { id: "thread-2", title: "Review providers", project: "Workspace" },
    { id: "thread-3", title: "WORKTREE cleanup", project: "Beta" },
  ];

  it("matches thread titles case-insensitively and preserves their order", () => {
    expect(searchSidebarThreadsByTitle(threads, "work")).toEqual([threads[0], threads[2]]);
  });

  it("does not match project metadata", () => {
    expect(searchSidebarThreadsByTitle(threads, "workspace")).toEqual([threads[0]]);
  });

  it("returns no results for an empty query", () => {
    expect(searchSidebarThreadsByTitle(threads, "   ")).toEqual([]);
  });
});

describe("sortThreadsForSidebarV2", () => {
  const sortable = (input: { id: string; createdAt: string }) => ({
    id: input.id,
    createdAt: input.createdAt,
  });

  it("orders by creation time, newest first, ignoring activity", () => {
    const sorted = sortThreadsForSidebarV2([
      sortable({ id: "oldest", createdAt: "2026-03-09T08:00:00.000Z" }),
      sortable({ id: "newest", createdAt: "2026-03-09T12:00:00.000Z" }),
      sortable({ id: "middle", createdAt: "2026-03-09T10:00:00.000Z" }),
    ]);

    expect(sorted.map((thread) => thread.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("breaks creation-time ties by id so the order is stable", () => {
    const sorted = sortThreadsForSidebarV2([
      sortable({ id: "b", createdAt: "2026-03-09T10:00:00.000Z" }),
      sortable({ id: "a", createdAt: "2026-03-09T10:00:00.000Z" }),
    ]);

    expect(sorted.map((thread) => thread.id)).toEqual(["a", "b"]);
  });
});

describe("applyManualThreadOrder", () => {
  const order = (ids: readonly string[], manualOrder: readonly string[]) =>
    applyManualThreadOrder({
      items: ids.map((id) => ({ id })),
      manualOrder,
      getKey: (item) => item.id,
    }).map((item) => item.id);

  it("leaves the natural order alone when nothing has been dragged", () => {
    expect(order(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
  });

  it("applies the dragged order", () => {
    expect(order(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("keeps a brand-new thread on top instead of flushing it to the end", () => {
    // "new" sorts newest-first into position 0 and has never been dragged.
    expect(order(["new", "a", "b", "c"], ["c", "a", "b"])).toEqual(["new", "c", "a", "b"]);
  });

  it("keeps an unarranged thread with the arranged neighbour above it", () => {
    // "b2" arrived directly under "b", so it travels with "b" to the top.
    expect(order(["a", "b", "b2", "c"], ["b", "c", "a"])).toEqual(["b", "b2", "c", "a"]);
  });

  it("ignores dragged keys for threads that are no longer in the list", () => {
    expect(order(["a", "c"], ["c", "gone", "a"])).toEqual(["c", "a"]);
  });

  it("falls back to natural order when no listed thread was ever dragged", () => {
    expect(order(["a", "b"], ["x", "y"])).toEqual(["a", "b"]);
  });
});

describe("moveThreadInManualOrder", () => {
  it("moves a thread down into the target's slot", () => {
    expect(moveThreadInManualOrder(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a thread up into the target's slot", () => {
    expect(moveThreadInManualOrder(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("is a no-op when the thread is dropped on itself", () => {
    expect(moveThreadInManualOrder(["a", "b"], "a", "a")).toEqual(["a", "b"]);
  });

  it("is a no-op when either key is unknown", () => {
    expect(moveThreadInManualOrder(["a", "b"], "a", "z")).toEqual(["a", "b"]);
    expect(moveThreadInManualOrder(["a", "b"], "z", "a")).toEqual(["a", "b"]);
  });
});

describe("sortSettledThreadsForSidebarV2", () => {
  const settled = (input: {
    id: string;
    settledAt?: string | null;
    latestUserMessageAt?: string | null;
    latestTurn?: OrchestrationLatestTurn | null;
    updatedAt?: string;
  }) => ({
    id: input.id,
    settledAt: input.settledAt ?? null,
    latestUserMessageAt: input.latestUserMessageAt ?? null,
    latestTurn: input.latestTurn ?? null,
    updatedAt: input.updatedAt ?? "2026-03-09T09:00:00.000Z",
  });

  it("orders by settle time, most recently settled first", () => {
    const sorted = sortSettledThreadsForSidebarV2([
      settled({
        id: "settled-first",
        settledAt: "2026-03-09T10:00:00.000Z",
        // Created/active later than the other thread: settle time must win.
        latestUserMessageAt: "2026-03-09T09:59:00.000Z",
      }),
      settled({
        id: "settled-last",
        settledAt: "2026-03-09T12:00:00.000Z",
        latestUserMessageAt: "2026-03-09T08:00:00.000Z",
      }),
    ]);

    expect(sorted.map((thread) => thread.id)).toEqual(["settled-last", "settled-first"]);
  });

  it("falls back to last activity for auto-settled threads without a settledAt stamp", () => {
    const sorted = sortSettledThreadsForSidebarV2([
      settled({ id: "auto-old", latestUserMessageAt: "2026-03-09T08:00:00.000Z" }),
      settled({ id: "explicit", settledAt: "2026-03-09T10:00:00.000Z" }),
      settled({ id: "auto-recent", latestUserMessageAt: "2026-03-09T11:00:00.000Z" }),
    ]);

    expect(sorted.map((thread) => thread.id)).toEqual(["auto-recent", "explicit", "auto-old"]);
  });

  it("counts a turn completion as activity for auto-settled threads", () => {
    // The message came in before the other thread's, but its turn finished
    // after: completion time is the real "work ended" moment.
    const sorted = sortSettledThreadsForSidebarV2([
      settled({ id: "message-only", latestUserMessageAt: "2026-03-09T10:04:00.000Z" }),
      settled({
        id: "completed-later",
        latestUserMessageAt: "2026-03-09T10:00:00.000Z",
        latestTurn: makeLatestTurn({ completedAt: "2026-03-09T10:30:00.000Z" }),
      }),
    ]);

    expect(sorted.map((thread) => thread.id)).toEqual(["completed-later", "message-only"]);
  });

  it("breaks timestamp ties by id so the order is stable", () => {
    const sorted = sortSettledThreadsForSidebarV2([
      settled({ id: "b", settledAt: "2026-03-09T10:00:00.000Z" }),
      settled({ id: "a", settledAt: "2026-03-09T10:00:00.000Z" }),
    ]);

    expect(sorted.map((thread) => thread.id)).toEqual(["a", "b"]);
  });
});

describe("resolveWorkingStartedAt", () => {
  const session = {
    threadId: ThreadId.make("thread-1"),
    status: "running" as const,
    providerName: "Codex",
    providerInstanceId: ProviderInstanceId.make("codex"),
    runtimeMode: DEFAULT_RUNTIME_MODE,
    activeTurnId: "turn-1" as never,
    lastError: null,
    updatedAt: "2026-03-09T10:02:00.000Z",
  };

  it("uses the running turn's start time", () => {
    expect(
      resolveWorkingStartedAt({
        latestTurn: makeLatestTurn({ completedAt: null }),
        session,
      }),
    ).toBe("2026-03-09T10:00:00.000Z");
  });

  it("uses the request time while a turn awaits adoption", () => {
    expect(
      resolveWorkingStartedAt({
        latestTurn: makeLatestTurn({ startedAt: null, completedAt: null }),
        session,
      }),
    ).toBe("2026-03-09T10:00:00.000Z");
  });

  it("falls back to the session transition when the latest turn already completed", () => {
    expect(
      resolveWorkingStartedAt({
        latestTurn: makeLatestTurn(),
        session,
      }),
    ).toBe("2026-03-09T10:02:00.000Z");
  });

  it("skips a malformed startedAt instead of returning it", () => {
    expect(
      resolveWorkingStartedAt({
        latestTurn: makeLatestTurn({ startedAt: "not-a-date", completedAt: null }),
        session,
      }),
    ).toBe("2026-03-09T10:00:00.000Z");
  });

  it("returns null with neither a running turn nor a session", () => {
    expect(resolveWorkingStartedAt({ latestTurn: null, session: null })).toBeNull();
  });
});

describe("formatWorkingDurationLabel", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatWorkingDurationLabel(0)).toBe("0s");
    expect(formatWorkingDurationLabel(42_000)).toBe("42s");
    expect(formatWorkingDurationLabel(5 * 60_000)).toBe("5m");
    expect(formatWorkingDurationLabel(90 * 60_000)).toBe("1h 30m");
  });

  it("clamps negative and non-finite elapsed values to zero", () => {
    expect(formatWorkingDurationLabel(-5_000)).toBe("0s");
    expect(formatWorkingDurationLabel(Number.NaN)).toBe("0s");
  });
});

describe("resolveThreadStatusPill", () => {
  const baseThread = {
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    interactionMode: "plan" as const,
    latestTurn: null,
    lastVisitedAt: undefined,
    session: {
      threadId: ThreadId.make("thread-1"),
      status: "running" as const,
      providerName: "Codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeMode: DEFAULT_RUNTIME_MODE,
      activeTurnId: "turn-1" as never,
      lastError: null,
      updatedAt: "2026-03-09T10:00:00.000Z",
    },
  };

  it("shows pending approval before all other statuses", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          hasPendingApprovals: true,
          hasPendingUserInput: true,
        },
      }),
    ).toMatchObject({ label: "Pending Approval", pulse: false });
  });

  it("shows awaiting input when plan mode is blocked on user answers", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          hasPendingUserInput: true,
        },
      }),
    ).toMatchObject({ label: "Awaiting Input", pulse: false });
  });

  it("falls back to working when the thread is actively running without blockers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
      }),
    ).toMatchObject({ label: "Working", pulse: true });
  });

  it("shows plan ready when a settled plan turn has a proposed plan ready for follow-up", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          hasActionableProposedPlan: true,
          latestTurn: makeLatestTurn(),
          session: {
            ...baseThread.session,
            status: "ready",
            activeTurnId: null,
          },
        },
      }),
    ).toMatchObject({ label: "Plan Ready", pulse: false });
  });

  it("does not manufacture completed state without a client visit marker", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          session: {
            ...baseThread.session,
            status: "ready",
            activeTurnId: null,
          },
        },
      }),
    ).toBeNull();
  });

  it("shows completed when there is an unseen completion and no active blocker", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          interactionMode: "default",
          latestTurn: makeLatestTurn(),
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          session: {
            ...baseThread.session,
            status: "ready",
            activeTurnId: null,
          },
        },
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });
});

describe("resolveThreadRowClassName", () => {
  it("uses a vivid, bounded violet focus treatment when a thread is selected and active", () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: true });
    expect(className).toContain("var(--sidebar-row-active)_82%");
    expect(className).toContain("text-sidebar-foreground");
    expect(className).toContain("ring-primary/50");
    expect(className).toContain("data-[active=true]:ring-primary/50");
    expect(className).toContain("var(--primary)_14%");
    expect(className).toContain("var(--astro-highlight)_10%");
    expect(className).toContain("w-[calc(100%-0.25rem)]");
    expect(className).not.toContain("shadow-[0_");
    expect(className).not.toContain("inset_2px");
    expect(className).not.toContain("bg-primary");
  });

  it("uses selected hover colors for selected threads", () => {
    const className = resolveThreadRowClassName({ isActive: false, isSelected: true });
    expect(className).toContain("var(--sidebar-row-selected)_88%");
    expect(className).toContain("var(--sidebar-row-active)_82%");
    expect(className).toContain("ring-primary/35");
    expect(className).toContain("hover:ring-primary/50");
    expect(className).not.toContain("bg-primary");
  });

  it("uses the active sidebar surface for active-only threads", () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: false });
    expect(className).toContain("var(--sidebar-row-active)_82%");
    expect(className).toContain("ring-primary/50");
    expect(className).toContain("data-[active=true]:ring-primary/50");
    expect(className).toContain("var(--astro-highlight)_10%");
    expect(className).not.toContain("shadow-[0_");
  });

  it("gives resting rows a quiet violet hover and disables transitions for reduced-motion users", () => {
    const className = resolveThreadRowClassName({ isActive: false, isSelected: false });
    expect(className).toContain("var(--sidebar-row-hover)_92%");
    expect(className).toContain("hover:ring-primary/15");
    expect(className).toContain("duration-200");
    expect(className).not.toContain("hover:translate");
    expect(className).toContain("w-[calc(100%-0.25rem)]");
    expect(className).not.toContain("inset_2px");
    expect(className).toContain("motion-reduce:transition-none");
  });
});

describe("resolveSidebarV2RowSurfaceClassName", () => {
  it("gives completed unseen work a branded perimeter glow", () => {
    const className = resolveSidebarV2RowSurfaceClassName({
      isActive: false,
      isSelected: false,
      isUnread: true,
      isInFlight: false,
      shouldRecede: false,
    });

    expect(className).toContain("ring-astro-highlight/55");
    expect(className).toContain("var(--primary)_42%");
    expect(className).toContain("var(--astro-highlight)_12%");
    expect(className).toContain("shadow-[0_0_8px");
    expect(className).toContain("motion-reduce:transition-none");
  });

  it("combines the active-route surface with the unread completion glow", () => {
    const className = resolveSidebarV2RowSurfaceClassName({
      isActive: true,
      isSelected: false,
      isUnread: true,
      isInFlight: false,
      shouldRecede: false,
    });

    expect(className).toContain("bg-sidebar-row-active");
    expect(className).toContain("ring-astro-highlight/55");
    expect(className).toContain("shadow-[0_0_8px");
  });
});

describe("resolveProjectStatusIndicator", () => {
  // Priority ordering is the whole contract here; the shared presentation
  // fields ride along unchanged, so a fixture supplies them.
  function pill(overrides: Pick<ThreadStatusPill, "label" | "colorClass" | "dotClass" | "pulse">) {
    return {
      ...overrides,
      axes: {
        activity: "running",
        attention: "none",
        outcome: "neutral",
        persistence: "active",
      },
      iconRole: "activity",
      motionClass: "motion-pending",
    } satisfies ThreadStatusPill;
  }

  it("returns null when no threads have a notable status", () => {
    expect(resolveProjectStatusIndicator([null, null])).toBeNull();
  });

  it("surfaces the highest-priority actionable state across project threads", () => {
    expect(
      resolveProjectStatusIndicator([
        pill({
          label: "Completed",
          colorClass: "text-emerald-600",
          dotClass: "bg-emerald-500",
          pulse: false,
        }),
        pill({
          label: "Pending Approval",
          colorClass: "text-amber-600",
          dotClass: "bg-amber-500",
          pulse: false,
        }),
        pill({
          label: "Working",
          colorClass: "text-primary",
          dotClass: "bg-primary",
          pulse: true,
        }),
      ]),
    ).toMatchObject({ label: "Pending Approval", dotClass: "bg-amber-500" });
  });

  it("prefers plan-ready over completed when no stronger action is needed", () => {
    expect(
      resolveProjectStatusIndicator([
        pill({
          label: "Completed",
          colorClass: "text-emerald-600",
          dotClass: "bg-emerald-500",
          pulse: false,
        }),
        pill({
          label: "Plan Ready",
          colorClass: "text-violet-600",
          dotClass: "bg-violet-500",
          pulse: false,
        }),
      ]),
    ).toMatchObject({ label: "Plan Ready", dotClass: "bg-violet-500" });
  });
});

describe("getVisibleThreadsForProject", () => {
  it("includes the active thread even when it falls below the folded preview", () => {
    const threads = Array.from({ length: 8 }, (_, index) =>
      makeThread({
        id: ThreadId.make(`thread-${index + 1}`),
        title: `Thread ${index + 1}`,
      }),
    );

    const result = getVisibleThreadsForProject({
      threads,
      activeThreadId: ThreadId.make("thread-8"),
      isThreadListExpanded: false,
      previewLimit: 6,
    });

    expect(result.hasHiddenThreads).toBe(true);
    expect(result.visibleThreads.map((thread) => thread.id)).toEqual([
      ThreadId.make("thread-1"),
      ThreadId.make("thread-2"),
      ThreadId.make("thread-3"),
      ThreadId.make("thread-4"),
      ThreadId.make("thread-5"),
      ThreadId.make("thread-6"),
      ThreadId.make("thread-8"),
    ]);
    expect(result.hiddenThreads.map((thread) => thread.id)).toEqual([ThreadId.make("thread-7")]);
  });

  it("returns all threads when the list is expanded", () => {
    const threads = Array.from({ length: 8 }, (_, index) =>
      makeThread({
        id: ThreadId.make(`thread-${index + 1}`),
      }),
    );

    const result = getVisibleThreadsForProject({
      threads,
      activeThreadId: ThreadId.make("thread-8"),
      isThreadListExpanded: true,
      previewLimit: 6,
    });

    expect(result.hasHiddenThreads).toBe(true);
    expect(result.visibleThreads.map((thread) => thread.id)).toEqual(
      threads.map((thread) => thread.id),
    );
    expect(result.hiddenThreads).toEqual([]);
  });
});

function makeProject(overrides: Partial<Project> = {}): Project {
  const { defaultModelSelection, ...rest } = overrides;
  return {
    id: ProjectId.make("project-1"),
    environmentId: localEnvironmentId,
    title: "Project",
    workspaceRoot: "/tmp/project",
    repositoryIdentity: null,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      ...defaultModelSelection,
    },
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
    scripts: [],
    ...rest,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.make("thread-1"),
    environmentId: localEnvironmentId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      ...overrides?.modelSelection,
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    proposedPlans: [],
    createdAt: "2026-03-09T10:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    checkpoints: [],
    activities: [],
    ...overrides,
  };
}

describe("getFallbackThreadIdAfterDelete", () => {
  it("returns the top remaining thread in the deleted thread's project sidebar order", () => {
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads: [
        makeThread({
          id: ThreadId.make("thread-oldest"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:00:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-active"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-newest"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:10:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-other-project"),
          projectId: ProjectId.make("project-2"),
          createdAt: "2026-03-09T10:20:00.000Z",
          messages: [],
        }),
      ],
      deletedThreadId: ThreadId.make("thread-active"),
      sortOrder: "created_at",
    });

    expect(fallbackThreadId).toBe(ThreadId.make("thread-newest"));
  });

  it("skips other threads being deleted in the same action", () => {
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads: [
        makeThread({
          id: ThreadId.make("thread-active"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-newest"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:10:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-next"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:07:00.000Z",
          messages: [],
        }),
      ],
      deletedThreadId: ThreadId.make("thread-active"),
      deletedThreadIds: new Set([ThreadId.make("thread-active"), ThreadId.make("thread-newest")]),
      sortOrder: "created_at",
    });

    expect(fallbackThreadId).toBe(ThreadId.make("thread-next"));
  });
});
describe("sortProjectsForSidebar", () => {
  it("sorts projects by the most recent user message across their threads", () => {
    const projects = [
      makeProject({ id: ProjectId.make("project-1"), title: "Older project" }),
      makeProject({ id: ProjectId.make("project-2"), title: "Newer project" }),
    ];
    const threads = [
      makeThread({
        projectId: ProjectId.make("project-1"),
        updatedAt: "2026-03-09T10:20:00.000Z",
        messages: [
          {
            id: "message-1" as never,
            role: "user",
            text: "older project user message",
            turnId: null,
            createdAt: "2026-03-09T10:01:00.000Z",
            updatedAt: "2026-03-09T10:01:00.000Z",
            streaming: false,
          },
        ],
      }),
      makeThread({
        id: ThreadId.make("thread-2"),
        projectId: ProjectId.make("project-2"),
        updatedAt: "2026-03-09T10:05:00.000Z",
        messages: [
          {
            id: "message-2" as never,
            role: "user",
            text: "newer project user message",
            turnId: null,
            createdAt: "2026-03-09T10:05:00.000Z",
            updatedAt: "2026-03-09T10:05:00.000Z",
            streaming: false,
          },
        ],
      }),
    ];

    const sorted = sortProjectsForSidebar(projects, threads, "updated_at");

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-2"),
      ProjectId.make("project-1"),
    ]);
  });

  it("falls back to project timestamps when a project has no threads", () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.make("project-1"),
          title: "Older project",
          updatedAt: "2026-03-09T10:01:00.000Z",
        }),
        makeProject({
          id: ProjectId.make("project-2"),
          title: "Newer project",
          updatedAt: "2026-03-09T10:05:00.000Z",
        }),
      ],
      [],
      "updated_at",
    );

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-2"),
      ProjectId.make("project-1"),
    ]);
  });

  it("falls back to name and id ordering when projects have no sortable timestamps", () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.make("project-2"),
          title: "Beta",
          createdAt: "invalid-created-at" as never,
          updatedAt: "invalid-updated-at" as never,
        }),
        makeProject({
          id: ProjectId.make("project-1"),
          title: "Alpha",
          createdAt: "invalid-created-at" as never,
          updatedAt: "invalid-updated-at" as never,
        }),
      ],
      [],
      "updated_at",
    );

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-1"),
      ProjectId.make("project-2"),
    ]);
  });

  it("preserves manual project ordering", () => {
    const projects = [
      makeProject({ id: ProjectId.make("project-2"), title: "Second" }),
      makeProject({ id: ProjectId.make("project-1"), title: "First" }),
    ];

    const sorted = sortProjectsForSidebar(projects, [], "manual");

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-2"),
      ProjectId.make("project-1"),
    ]);
  });

  it("ignores archived threads when sorting projects", () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.make("project-1"),
          title: "Visible project",
          updatedAt: "2026-03-09T10:01:00.000Z",
        }),
        makeProject({
          id: ProjectId.make("project-2"),
          title: "Archived-only project",
          updatedAt: "2026-03-09T10:00:00.000Z",
        }),
      ],
      [
        makeThread({
          id: ThreadId.make("thread-visible"),
          projectId: ProjectId.make("project-1"),
          updatedAt: "2026-03-09T10:02:00.000Z",
          archivedAt: null,
        }),
        makeThread({
          id: ThreadId.make("thread-archived"),
          projectId: ProjectId.make("project-2"),
          updatedAt: "2026-03-09T10:10:00.000Z",
          archivedAt: "2026-03-09T10:11:00.000Z",
        }),
      ].filter((thread) => thread.archivedAt === null),
      "updated_at",
    );

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-1"),
      ProjectId.make("project-2"),
    ]);
  });

  it("returns the project timestamp when no threads are present", () => {
    const timestamp = getProjectSortTimestamp(
      makeProject({ updatedAt: "2026-03-09T10:10:00.000Z" }),
      [],
      "updated_at",
    );

    expect(timestamp).toBe(Date.parse("2026-03-09T10:10:00.000Z"));
  });
});

describe("sortScopedProjectsForSidebar", () => {
  it("keeps identical project ids in different environments separate", () => {
    const remoteEnvironmentId = EnvironmentId.make("environment-remote");
    const sharedProjectId = ProjectId.make("shared-project");
    const projects = [
      makeProject({
        environmentId: localEnvironmentId,
        id: sharedProjectId,
        title: "Local project",
      }),
      makeProject({
        environmentId: remoteEnvironmentId,
        id: sharedProjectId,
        title: "Remote project",
      }),
    ];
    const threads = [
      makeThread({
        environmentId: localEnvironmentId,
        projectId: sharedProjectId,
        updatedAt: "2026-03-09T10:02:00.000Z",
      }),
      makeThread({
        environmentId: remoteEnvironmentId,
        projectId: sharedProjectId,
        updatedAt: "2026-03-09T10:10:00.000Z",
      }),
    ];

    const sorted = sortScopedProjectsForSidebar(projects, threads, "updated_at");

    expect(sorted.map((project) => project.title)).toEqual(["Remote project", "Local project"]);
  });

  it("does not use archived threads as project activity", () => {
    const projects = [
      makeProject({
        id: ProjectId.make("project-visible"),
        title: "Visible project",
        updatedAt: "2026-03-09T10:01:00.000Z",
      }),
      makeProject({
        id: ProjectId.make("project-archived"),
        title: "Archived-only project",
        updatedAt: "2026-03-09T10:00:00.000Z",
      }),
    ];
    const threads = [
      makeThread({
        id: ThreadId.make("thread-visible"),
        projectId: ProjectId.make("project-visible"),
        updatedAt: "2026-03-09T10:02:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("thread-archived"),
        projectId: ProjectId.make("project-archived"),
        updatedAt: "2026-03-09T10:10:00.000Z",
        archivedAt: "2026-03-09T10:11:00.000Z",
      }),
    ];

    const sorted = sortScopedProjectsForSidebar(projects, threads, "updated_at");

    expect(sorted.map((project) => project.title)).toEqual([
      "Visible project",
      "Archived-only project",
    ]);
  });
});

describe("sortLogicalProjectsForSidebar", () => {
  it("uses saved order only in manual mode and activity order otherwise", () => {
    const olderProjectId = ProjectId.make("project-older");
    const newerProjectId = ProjectId.make("project-newer");
    const projects = [
      {
        ...makeProject({ id: olderProjectId, title: "Older project" }),
        projectKey: "logical-older",
        memberProjectRefs: [{ environmentId: localEnvironmentId, projectId: olderProjectId }],
      },
      {
        ...makeProject({ id: newerProjectId, title: "Newer project" }),
        projectKey: "logical-newer",
        memberProjectRefs: [{ environmentId: localEnvironmentId, projectId: newerProjectId }],
      },
    ];
    const threads = [
      makeThread({
        projectId: olderProjectId,
        updatedAt: "2026-03-09T10:01:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("thread-newer"),
        projectId: newerProjectId,
        updatedAt: "2026-03-09T10:05:00.000Z",
      }),
    ];

    expect(sortLogicalProjectsForSidebar(projects, threads, "manual")).toEqual(projects);
    expect(
      sortLogicalProjectsForSidebar(projects, threads, "updated_at").map(
        (project) => project.projectKey,
      ),
    ).toEqual(["logical-newer", "logical-older"]);
  });
});

describe("thread settlement acknowledgment", () => {
  const key = "environment-local:thread-1";
  const other = "environment-local:thread-2";

  it("shows a pending owner on press and no accent until the server confirms", () => {
    const pressed = beginThreadSettle(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, {
      threadKey: key,
      source: "single",
    });

    expect(threadSettlePhase(pressed, key)).toBe("pending");
    expect(pressed.acknowledged.has(key)).toBe(false);
  });

  it("acknowledges a user-initiated single settle only after it succeeds", () => {
    const pressed = beginThreadSettle(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, {
      threadKey: key,
      source: "single",
    });
    const settled = resolveThreadSettle(pressed, { threadKey: key, outcome: "success" });

    expect(threadSettlePhase(settled, key)).toBe("acknowledged");
  });

  // Hold-in-place window. A single success both lights the accent AND pins the
  // row in its active slot so the ring laps before the FLIP relocates it. The
  // held set is a subset of acknowledged, so the phase is still "acknowledged".
  it("holds a single settle in its active slot while it is acknowledged", () => {
    const settled = resolveThreadSettle(
      beginThreadSettle(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, { threadKey: key, source: "single" }),
      { threadKey: key, outcome: "success" },
    );

    expect(settled.held.has(key)).toBe(true);
    expect(settled.acknowledged.has(key)).toBe(true);
    expect(threadSettlePhase(settled, key)).toBe("acknowledged");
  });

  it("does not hold bulk, automatic, or failed settles", () => {
    const bulk = resolveThreadSettle(
      beginThreadSettle(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, { threadKey: key, source: "bulk" }),
      { threadKey: key, outcome: "success" },
    );
    const automatic = resolveThreadSettle(
      beginThreadSettle(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, {
        threadKey: key,
        source: "automatic",
      }),
      { threadKey: key, outcome: "success" },
    );
    const failed = resolveThreadSettle(
      beginThreadSettle(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, { threadKey: key, source: "single" }),
      { threadKey: key, outcome: "failure" },
    );

    expect(bulk.held.size).toBe(0);
    expect(automatic.held.size).toBe(0);
    expect(failed.held.size).toBe(0);
  });

  // Releasing the hold lets the row regroup (and the FLIP play) while the accent
  // is still lit: the key leaves `held` but stays `acknowledged`.
  it("releases the hold without dropping the acknowledgment", () => {
    const settled = resolveThreadSettle(
      beginThreadSettle(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, { threadKey: key, source: "single" }),
      { threadKey: key, outcome: "success" },
    );
    const released = releaseThreadSettleHold(settled, { threadKey: key });

    expect(released.held.has(key)).toBe(false);
    expect(threadSettlePhase(released, key)).toBe("acknowledged");
  });

  it("is inert when releasing a hold no row is holding", () => {
    expect(releaseThreadSettleHold(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, { threadKey: key })).toBe(
      EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT,
    );
    // A second release after the first is also a no-op.
    const released = releaseThreadSettleHold(
      resolveThreadSettle(
        beginThreadSettle(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, {
          threadKey: key,
          source: "single",
        }),
        { threadKey: key, outcome: "success" },
      ),
      { threadKey: key },
    );
    expect(releaseThreadSettleHold(released, { threadKey: key })).toBe(released);
  });

  it("drops a lingering hold when the acknowledgment is cleared", () => {
    const settled = resolveThreadSettle(
      beginThreadSettle(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, { threadKey: key, source: "single" }),
      { threadKey: key, outcome: "success" },
    );
    const cleared = clearThreadSettleMark(settled, { threadKey: key, mark: "acknowledged" });

    expect(cleared.held.has(key)).toBe(false);
    expect(threadSettlePhase(cleared, key)).toBe("idle");
  });

  it("clears a stale hold when the same thread is settled again", () => {
    const settled = resolveThreadSettle(
      beginThreadSettle(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, { threadKey: key, source: "single" }),
      { threadKey: key, outcome: "success" },
    );
    const retried = beginThreadSettle(settled, { threadKey: key, source: "single" });

    expect(retried.held.has(key)).toBe(false);
    expect(threadSettlePhase(retried, key)).toBe("pending");
  });

  // The single-vs-bulk distinction. N rows each firing the Level 3 accent is
  // precisely the intensity creep the ladder forbids.
  it("keeps a bulk settle quiet even though it succeeds", () => {
    const pressed = beginThreadSettle(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, {
      threadKey: key,
      source: "bulk",
    });
    const settled = resolveThreadSettle(pressed, { threadKey: key, outcome: "success" });

    expect(threadSettlePhase(settled, key)).toBe("idle");
    expect(settled.acknowledged.size).toBe(0);
  });

  it("keeps an automatic settle quiet", () => {
    const pressed = beginThreadSettle(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, {
      threadKey: key,
      source: "automatic",
    });
    const settled = resolveThreadSettle(pressed, { threadKey: key, outcome: "success" });

    expect(threadSettlePhase(settled, key)).toBe("idle");
  });

  it("gives a failed settle destructive emphasis and no completion accent", () => {
    const pressed = beginThreadSettle(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, {
      threadKey: key,
      source: "single",
    });
    const failed = resolveThreadSettle(pressed, { threadKey: key, outcome: "failure" });

    expect(threadSettlePhase(failed, key)).toBe("failed");
    expect(failed.acknowledged.size).toBe(0);
  });

  // Replay prevention. Auto-settlement, a row remounting into the settled
  // shelf, a reorder, a project-scope flip, and opening an already-settled
  // thread all reach the reducer (if at all) WITHOUT a preceding press, and a
  // resolve with no pending entry must be inert.
  it("ignores a settlement that no press started", () => {
    const state = resolveThreadSettle(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, {
      threadKey: key,
      outcome: "success",
    });

    expect(state).toBe(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT);
    expect(threadSettlePhase(state, key)).toBe("idle");
  });

  it("cannot replay the accent once the one-shot has been cleared", () => {
    const settled = resolveThreadSettle(
      beginThreadSettle(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, {
        threadKey: key,
        source: "single",
      }),
      { threadKey: key, outcome: "success" },
    );
    const cleared = clearThreadSettleMark(settled, { threadKey: key, mark: "acknowledged" });

    expect(threadSettlePhase(cleared, key)).toBe("idle");
    // A later resolve — a duplicate response, a remount re-reporting the same
    // settled row — finds nothing pending and changes nothing.
    expect(resolveThreadSettle(cleared, { threadKey: key, outcome: "success" })).toBe(cleared);
  });

  it("scopes every phase to its own thread key", () => {
    const state = resolveThreadSettle(
      beginThreadSettle(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, {
        threadKey: key,
        source: "single",
      }),
      { threadKey: key, outcome: "success" },
    );

    expect(threadSettlePhase(state, other)).toBe("idle");
  });

  it("clears a stale outcome when the same thread is settled again", () => {
    const failed = resolveThreadSettle(
      beginThreadSettle(EMPTY_THREAD_SETTLE_ACKNOWLEDGEMENT, {
        threadKey: key,
        source: "single",
      }),
      { threadKey: key, outcome: "failure" },
    );
    const retried = beginThreadSettle(failed, { threadKey: key, source: "single" });

    expect(threadSettlePhase(retried, key)).toBe("pending");
    expect(retried.failed.has(key)).toBe(false);
  });
});

describe("resolveThreadStatusPill shared status axes", () => {
  const runningThread = {
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    interactionMode: DEFAULT_INTERACTION_MODE,
    latestTurn: null,
    lastVisitedAt: undefined,
    session: {
      threadId: ThreadId.make("thread-1"),
      status: "running" as const,
      providerName: "Codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeMode: DEFAULT_RUNTIME_MODE,
      activeTurnId: "turn-1" as never,
      lastError: null,
      updatedAt: "2026-03-09T10:00:00.000Z",
    },
  };

  it("uses the shared violet running recipe rather than the old cyan/blue treatment", () => {
    const pill = resolveThreadStatusPill({ thread: runningThread });

    expect(pill?.colorClass).toContain("text-primary");
    expect(pill?.colorClass).not.toContain("sky");
    expect(pill?.dotClass).not.toContain("sky");
  });

  it("carries an icon role and motion recipe so status is never colour alone", () => {
    const pill = resolveThreadStatusPill({ thread: runningThread });

    expect(pill?.iconRole).toBe("activity");
    expect(pill?.motionClass).toBe("motion-pending");
    expect(pill?.axes.activity).toBe("running");
  });

  it("treats connecting as ongoing activity, not information", () => {
    const pill = resolveThreadStatusPill({
      thread: { ...runningThread, session: { ...runningThread.session, status: "starting" } },
    });

    expect(pill?.label).toBe("Connecting");
    expect(pill?.iconRole).toBe("activity");
    expect(pill?.colorClass).not.toContain("sky");
  });

  it("earns the completion motion only while the result is unseen", () => {
    const completed = {
      ...runningThread,
      latestTurn: makeLatestTurn(),
      session: { ...runningThread.session, status: "ready" as const, activeTurnId: null },
    };

    const unseen = resolveThreadStatusPill({
      thread: { ...completed, lastVisitedAt: "2026-03-09T10:01:00.000Z" },
    });
    expect(unseen?.label).toBe("Completed");
    expect(unseen?.motionClass).toBe("motion-completion");

    // Once the user has opened the thread the pill disappears entirely, so
    // restored history has nothing to replay.
    expect(
      resolveThreadStatusPill({
        thread: { ...completed, lastVisitedAt: "2026-03-09T10:06:00.000Z" },
      }),
    ).toBeNull();
  });
});
