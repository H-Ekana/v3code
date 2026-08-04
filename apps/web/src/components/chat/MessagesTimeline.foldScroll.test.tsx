// @vitest-environment happy-dom
//
// The send-edge half of the "chat jumps to the top and back" bug.
//
// The first fix deferred a settled turn's fold to "the next turn". A turn is
// created the instant the user sends, so that moved the multi-thousand-pixel
// collapse from the settle edge onto the SEND edge — which carries the same
// pending `scrollToEnd` (ChatView re-pins on the new user message and on the
// shrinking composer) and therefore the same skipped
// `maintainVisibleContentPosition`.
//
// The compensation that was supposed to cover this never ran. It committed the
// fold with `flushSync` from inside an effect, and React refuses to flush there
// ("React cannot flush when React is already rendering"), so it measured a DOM
// the fold had not touched yet, saw every anchor unmoved, and always corrected
// by nothing. The fix moves the measurement into a layout effect on the far
// side of the fold's commit — before paint, where a correction is invisible.
//
// `scrollToOffset` is mocked to record without applying, because legend-list
// defers it behind an rAF settle loop (`runScrollRequest` → `runWhenReady`) and
// a correction that lands a frame late means the uncorrected frame paints
// first. Anything this test observes on the scroller got there synchronously.
import { EnvironmentId, MessageId, TurnId } from "@t3tools/contracts";
import { createRef, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { LegendListRef } from "@legendapp/list/react";

const VIEWPORT_HEIGHT = 800;
const ROW_HEIGHT = 400;

interface FakeScroller extends HTMLDivElement {
  __rowCount: number;
}

/** Clamps `scrollTop` to the content height, as a real scroller does. */
function installScrollMetrics(node: HTMLDivElement, rowCount: number): FakeScroller {
  const scroller = node as FakeScroller;
  if (scroller.__rowCount === undefined) {
    let scrollTop = 0;
    Object.defineProperty(scroller, "clientHeight", { get: () => VIEWPORT_HEIGHT });
    Object.defineProperty(scroller, "scrollHeight", {
      get: () => scroller.__rowCount * ROW_HEIGHT,
    });
    Object.defineProperty(scroller, "scrollTop", {
      get: () => scrollTop,
      set: (value: number) => {
        const max = Math.max(0, scroller.scrollHeight - VIEWPORT_HEIGHT);
        scrollTop = Math.max(0, Math.min(value, max));
      },
    });
  }
  scroller.__rowCount = rowCount;
  return scroller;
}

const recordedScrollToOffsets: number[] = [];

vi.mock("@legendapp/list/react", () => {
  const LegendList = (props: {
    data: Array<{ id: string }>;
    keyExtractor: (item: { id: string }) => string;
    renderItem: (args: { item: { id: string } }) => ReactNode;
    ref?: Ref<LegendListRef>;
  }) => {
    const attach = (node: HTMLDivElement | null) => {
      if (!node) {
        return;
      }
      const scroller = installScrollMetrics(node, props.data.length);
      const api = {
        getScrollableNode: () => scroller,
        getState: () => ({ scroll: scroller.scrollTop }),
        // Deliberately inert: legend-list may not apply this until a later
        // frame, so the fix must not rely on it.
        scrollToOffset: ({ offset }: { offset: number }) => {
          recordedScrollToOffsets.push(offset);
          return Promise.resolve();
        },
      } as unknown as LegendListRef;
      if (typeof props.ref === "function") {
        props.ref(api);
      } else if (props.ref) {
        (props.ref as { current: LegendListRef | null }).current = api;
      }
    };

    return (
      <div data-testid="legend-list" ref={attach}>
        {props.data.map((item) => (
          <div key={props.keyExtractor(item)}>{props.renderItem({ item })}</div>
        ))}
      </div>
    );
  };
  return { LegendList };
});

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: (props: { fileDiff: { name?: string | null } }) => (
    <div data-testid="file-diff">{props.fileDiff.name ?? "diff"}</div>
  ),
}));

/**
 * happy-dom has no layout, so rows are given a synthetic one: stacked in DOM
 * order, scrolled by the live `scrollTop`. This is what lets the compensator's
 * viewport-space measurement mean anything here.
 */
function installLayoutStub() {
  const measure = function (this: Element): DOMRect {
    const scroller = document.querySelector('[data-testid="legend-list"]') as FakeScroller | null;
    const element = this as HTMLElement;
    const rect = (top: number, height: number) =>
      ({
        top,
        bottom: top + height,
        height,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;

    if (element.dataset?.timelineRowId !== undefined) {
      const rows = [...document.querySelectorAll("[data-timeline-row-id]")];
      const index = rows.indexOf(element);
      return rect(index * ROW_HEIGHT - (scroller?.scrollTop ?? 0), ROW_HEIGHT);
    }
    // Everything else — the timeline viewport the compensator measures against
    // included — is the visible band itself.
    return rect(0, VIEWPORT_HEIGHT);
  };

  // happy-dom may define this on either prototype; shadowing wins, so set both.
  Element.prototype.getBoundingClientRect = measure;
  HTMLElement.prototype.getBoundingClientRect = measure;
}

let MessagesTimeline: typeof import("./MessagesTimeline").MessagesTimeline;

beforeAll(async () => {
  // Deliberately NOT an act environment. `act` flushes passive effects inside
  // React's own work loop, where `flushSync` refuses to flush ("React cannot
  // flush when React is already rendering") — which silently turns the
  // compensator into a no-op and would make this test meaningless. A browser
  // runs passive effects in their own task, so renders here are driven the same
  // way and awaited.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    });
  }
  if (typeof globalThis.ResizeObserver !== "function") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  installLayoutStub();
  ({ MessagesTimeline } = await import("./MessagesTimeline"));
}, 30_000);

const ENV = EnvironmentId.make("environment-local");
const AT = "2026-03-17T19:12:28.000Z";
const TURN_1 = TurnId.make("turn-1");
const TURN_2 = TurnId.make("turn-2");

function baseProps() {
  return {
    isWorking: false,
    activeTurnInProgress: false,
    activeTurnStartedAt: null,
    listRef: createRef<LegendListRef | null>(),
    latestTurn: null,
    runningTurnId: null,
    turnDiffSummaryByAssistantMessageId: new Map(),
    routeThreadKey: "environment-local:thread-1",
    onOpenTurnDiff: () => {},
    revertTurnCountByUserMessageId: new Map(),
    onRevertUserMessage: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    activeThreadEnvironmentId: ENV,
    markdownCwd: undefined,
    resolvedTheme: "light" as const,
    timestampFormat: "locale" as const,
    workspaceRoot: undefined,
    contentInsetEndAdjustment: 0,
    followOutput: true,
    onIsAtEndChange: () => {},
    onManualNavigation: () => {},
    onAddConversationReference: () => true,
  };
}

function userEntry(id: string, text: string) {
  return {
    id: `entry-${id}`,
    kind: "message" as const,
    createdAt: AT,
    message: {
      id: MessageId.make(id),
      role: "user" as const,
      text,
      turnId: null,
      createdAt: AT,
      updatedAt: AT,
      streaming: false,
    },
  };
}

function assistantEntry(id: string, text: string, streaming: boolean, turnId: TurnId | null) {
  return {
    id: `entry-${id}`,
    kind: "message" as const,
    createdAt: AT,
    message: {
      id: MessageId.make(id),
      role: "assistant" as const,
      text,
      turnId,
      createdAt: AT,
      updatedAt: AT,
      streaming,
    },
  };
}

function workEntry(suffix: string, index: number, turnId: TurnId) {
  return {
    id: `entry-work-${suffix}-${index}`,
    kind: "work" as const,
    createdAt: AT,
    entry: {
      id: `work-${suffix}-${index}`,
      createdAt: AT,
      label: "Bash",
      tone: "tool" as const,
      turnId,
      command: "pnpm test",
      toolCallId: `call-${suffix}-${index}`,
      toolLifecycleStatus: "completed" as const,
      detail: "Completed successfully",
    },
  };
}

/**
 * A turn whose work does NOT collapse into a single grouped row: consecutive
 * work entries group, so commentary is interleaved to keep each one its own row
 * and make the fold a genuinely large deletion.
 */
function turnEntries(turnId: TurnId, suffix: string, streaming: boolean) {
  return [
    userEntry(`message-${suffix}`, `Question ${suffix}`),
    ...Array.from({ length: 6 }, (_, index) => [
      workEntry(suffix, index, turnId),
      assistantEntry(`commentary-${suffix}-${index}`, `Working ${index}`, false, turnId),
    ]).flat(),
    assistantEntry(`assistant-${suffix}`, `Answer ${suffix}`, streaming, turnId),
  ];
}

/**
 * Lets React commit, run passive effects, and commit whatever those effects
 * schedule — the deferred fold needs that second commit — as a browser would
 * across a couple of frames.
 */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 4; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function scrollerOf(container: HTMLElement): FakeScroller {
  return container.querySelector('[data-testid="legend-list"]') as FakeScroller;
}

function rowTop(container: HTMLElement, rowId: string): number | null {
  const element = container.querySelector(`[data-timeline-row-id="${rowId}"]`);
  return element ? element.getBoundingClientRect().top : null;
}

async function mount(children: ReactNode): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  // Async act flushes passive effects outside React's render phase, which is
  // where they run in a browser. Synchronous act makes the component's own
  // `flushSync` a no-op ("React cannot flush when React is already rendering"),
  // which would silently defeat the very measurement under test.
  root.render(children);
  await settle();
  return { container, root };
}

describe("MessagesTimeline fold scroll compensation at the send edge", () => {
  it("holds the reader's anchor when the deferred fold lands on send", async () => {
    recordedScrollToOffsets.length = 0;
    const props = baseProps();

    const { container, root } = await mount(
      <MessagesTimeline
        {...props}
        isWorking
        activeTurnInProgress
        activeTurnStartedAt={AT}
        runningTurnId={TURN_1}
        latestTurn={{ turnId: TURN_1, state: "running", startedAt: AT, completedAt: null }}
        timelineEntries={turnEntries(TURN_1, "1", true)}
      />,
    );

    // Turn 1 settles. The deferral keeps its work rows on screen for now.
    const settledEntries = turnEntries(TURN_1, "1", false);
    const settledProps = {
      ...props,
      runningTurnId: null,
      latestTurn: { turnId: TURN_1, state: "completed" as const, startedAt: AT, completedAt: AT },
      timelineEntries: settledEntries,
    };
    root.render(<MessagesTimeline {...settledProps} />);
    await settle();

    const scroller = scrollerOf(container);
    const rowsBeforeFold = scroller.__rowCount;

    // Park the reader with the turn's terminal answer — a row the fold keeps —
    // at the top of the viewport, and everything the fold deletes above them.
    const anchorId = "entry-assistant-1";
    const anchorIndexBefore = [...container.querySelectorAll("[data-timeline-row-id]")].findIndex(
      (element) => element.getAttribute("data-timeline-row-id") === anchorId,
    );
    expect(anchorIndexBefore).toBeGreaterThan(0);
    // Scroll as far toward the anchor as the content allows; the scroller
    // clamps, which is fine — only where it ends up matters from here.
    scroller.scrollTop = anchorIndexBefore * ROW_HEIGHT;
    const anchorTopBefore = rowTop(container, anchorId);
    expect(anchorTopBefore).not.toBeNull();
    expect(anchorTopBefore).toBeLessThan(VIEWPORT_HEIGHT);

    // The user sends. Turn 2 is created, so the deferred fold lands and deletes
    // every work row and commentary message of turn 1 in one commit.
    root.render(
      <MessagesTimeline
        {...settledProps}
        isWorking
        activeTurnInProgress
        activeTurnStartedAt={AT}
        runningTurnId={TURN_2}
        latestTurn={{ turnId: TURN_2, state: "running", startedAt: AT, completedAt: null }}
        timelineEntries={[...settledEntries, userEntry("message-2", "Follow-up question")]}
      />,
    );
    await settle();

    // The collapse really happened: this is the commit that jumps.
    expect(scroller.__rowCount).toBeLessThan(rowsBeforeFold);
    expect(container.querySelector('[data-timeline-row-id="entry-work-1-0"]')).toBeNull();

    // The reader is still looking at the same row, in the same place. Since
    // `scrollToOffset` never applies, this can only be true if the correction
    // was written to the scroller during the commit.
    expect(rowTop(container, anchorId)).toBe(anchorTopBefore);
    expect(recordedScrollToOffsets.at(-1)).toBe(scroller.scrollTop);

    root.unmount();
  });
});
