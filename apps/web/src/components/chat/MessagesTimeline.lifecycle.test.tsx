// @vitest-environment happy-dom
//
// Client-render lifecycle tests for the conversation timeline. These mount the
// real component with `createRoot` + `act`, then re-render with new props and
// assert against the *live DOM* — never an SSR string. The motion-polish
// diagnosis established that `renderToStaticMarkup` assertions are exactly why
// the arrival/live-edge/tool bugs shipped green: a class can be present in one
// render string and still never reach a painted element, be clipped to zero
// pixels, or key a one-shot that never arms.
import { EnvironmentId, MessageId, TurnId } from "@t3tools/contracts";
import { createRef, type ReactNode, type Ref } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { LegendListRef } from "@legendapp/list/react";

// The real LegendList virtualizes with ResizeObserver/rAF measurement, which
// does not settle in happy-dom. Render every row synchronously so the DOM under
// test is the row content itself — the arrival/edge/tool markers live there.
vi.mock("@legendapp/list/react", () => {
  const LegendList = (props: {
    data: Array<{ id: string }>;
    keyExtractor: (item: { id: string }) => string;
    renderItem: (args: { item: { id: string } }) => ReactNode;
    ref?: Ref<LegendListRef>;
  }) => (
    <div data-testid="legend-list">
      {props.data.map((item) => (
        <div key={props.keyExtractor(item)}>{props.renderItem({ item })}</div>
      ))}
    </div>
  );
  return { LegendList };
});

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: (props: { fileDiff: { name?: string | null } }) => (
    <div data-testid="file-diff">{props.fileDiff.name ?? "diff"}</div>
  ),
}));

let MessagesTimeline: typeof import("./MessagesTimeline").MessagesTimeline;

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
  }
  if (typeof globalThis.ResizeObserver !== "function") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  ({ MessagesTimeline } = await import("./MessagesTimeline"));
}, 30_000);

const ENV = EnvironmentId.make("environment-local");
const AT = "2026-03-17T19:12:28.000Z";

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

function mount(children: ReactNode): { container: HTMLElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(children));
  return { container, root };
}

function arrivalBubbles(container: HTMLElement): Element[] {
  return [...container.querySelectorAll(".conversation-user-arrival")];
}

describe("MessagesTimeline user-turn arrival (live DOM)", () => {
  it("plays the arrival exactly once on the newly created user turn, not on history", () => {
    const props = baseProps();
    // First commit is history: a prior exchange the ledger records silently.
    const { container, root } = mount(
      <MessagesTimeline
        {...props}
        timelineEntries={[
          userEntry("message-1", "First question"),
          assistantEntry("assistant-1", "First answer", false, null),
        ]}
      />,
    );

    expect(arrivalBubbles(container)).toHaveLength(0);

    // The user sends a new message: it appears for the first time in the row
    // array. This is the transition the ledger must observe.
    act(() => {
      root.render(
        <MessagesTimeline
          {...props}
          timelineEntries={[
            userEntry("message-1", "First question"),
            assistantEntry("assistant-1", "First answer", false, null),
            userEntry("message-2", "Second question"),
          ]}
        />,
      );
    });

    const arriving = arrivalBubbles(container);
    expect(arriving).toHaveLength(1);
    // The arrival is on the *new* bubble, and it carries the data hook.
    expect(arriving[0]?.getAttribute("data-user-turn-arrival")).toBe("true");
    expect(arriving[0]?.textContent).toContain("Second question");

    // A subsequent unrelated re-render (e.g. the assistant starts streaming)
    // must not replay the arrival on the same message.
    act(() => {
      root.render(
        <MessagesTimeline
          {...props}
          timelineEntries={[
            userEntry("message-1", "First question"),
            assistantEntry("assistant-1", "First answer", false, null),
            userEntry("message-2", "Second question"),
            assistantEntry("assistant-2", "", true, TurnId.make("turn-2")),
          ]}
        />,
      );
    });
    // Still exactly one arriving bubble in-flight (message-2); it has not
    // re-armed a second time, and message-1 never arrives.
    expect(arrivalBubbles(container).length).toBeLessThanOrEqual(1);

    act(() => root.unmount());
  });
});

function workEntry(opts: {
  entryId: string;
  toolCallId: string;
  status: "inProgress" | "completed";
  turnId: TurnId;
  detail?: string;
}) {
  return {
    id: `entry-${opts.entryId}`,
    kind: "work" as const,
    createdAt: AT,
    entry: {
      id: opts.entryId,
      createdAt: AT,
      label: "Bash",
      tone: "tool" as const,
      turnId: opts.turnId,
      command: "pnpm test",
      toolCallId: opts.toolCallId,
      toolLifecycleStatus: opts.status,
      ...(opts.detail ? { detail: opts.detail } : {}),
    },
  };
}

function caretHooks(container: HTMLElement): Element[] {
  return [...container.querySelectorAll(".conversation-live-caret")];
}

describe("MessagesTimeline persisted hydration (live DOM)", () => {
  it("renders a long incrementally supplied history without taking the arrival path", () => {
    const props = baseProps();
    let history: ReturnType<typeof userEntry | typeof assistantEntry>[] = [];
    const { container, root } = mount(
      <MessagesTimeline {...props} initialHydration timelineEntries={history} />,
    );

    // Model a pathological reducer replay: many persisted rows arrive in
    // separate React commits. The explicit guard must keep every commit static.
    for (let index = 0; index < 40; index += 1) {
      history = [
        ...history,
        userEntry(`history-user-${index}`, `Historical question ${index}`),
        assistantEntry(`history-assistant-${index}`, `Historical answer ${index}`, false, null),
      ];
      act(() => {
        root.render(<MessagesTimeline {...props} initialHydration timelineEntries={history} />);
      });
      expect(arrivalBubbles(container)).toHaveLength(0);
      expect(container.querySelector(".conversation-tool-flash")).toBeNull();
      expect(container.querySelector('[data-live-response-edge="resolved"]')).toBeNull();
    }

    // Committing the collapsed snapshot must remain inert too.
    act(() => {
      root.render(<MessagesTimeline {...props} timelineEntries={history} />);
    });
    expect(arrivalBubbles(container)).toHaveLength(0);

    act(() => root.unmount());
  });

  it("animates a genuinely new user message after hydration commits", () => {
    const props = baseProps();
    const history = [
      userEntry("history-user", "Historical question"),
      assistantEntry("history-assistant", "Historical answer", false, null),
    ];
    const { container, root } = mount(
      <MessagesTimeline {...props} initialHydration timelineEntries={history} />,
    );

    act(() => {
      root.render(<MessagesTimeline {...props} timelineEntries={history} />);
    });
    expect(arrivalBubbles(container)).toHaveLength(0);

    act(() => {
      root.render(
        <MessagesTimeline
          {...props}
          timelineEntries={[...history, userEntry("live-user", "Actually new")]}
        />,
      );
    });

    const arrivals = arrivalBubbles(container);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0]?.textContent).toContain("Actually new");

    act(() => root.unmount());
  });
});

describe("MessagesTimeline live-response caret (live DOM)", () => {
  it("mounts the caret hook at the end of the newest streaming message's content", () => {
    const props = baseProps();
    const turnId = TurnId.make("turn-stream");
    const { container, root } = mount(
      <MessagesTimeline
        {...props}
        activeTurnInProgress
        runningTurnId={turnId}
        latestTurn={{ turnId, state: "running", startedAt: AT, completedAt: null }}
        timelineEntries={[
          userEntry("message-1", "Question"),
          assistantEntry("assistant-1", "Streaming reply", true, turnId),
        ]}
      />,
    );

    const host = container.querySelector('[data-live-response-edge="streaming"]');
    expect(host).not.toBeNull();
    // The caret hook is a real child inside the streaming host — the visible
    // caret is a CSS `::after` gated on this element's presence, so the hook is
    // what the growth-point caret rides. Exactly one, and inside the host.
    const carets = caretHooks(container);
    expect(carets).toHaveLength(1);
    expect(host?.contains(carets[0]!)).toBe(true);
    // It lives inside the markdown content (so `::after` on the last text block
    // resolves to the end of the streamed text), not as a bare row sibling.
    expect(carets[0]?.closest(".chat-markdown")).not.toBeNull();
    expect(carets[0]?.parentElement?.lastElementChild).toBe(carets[0]);

    act(() => root.unmount());
  });

  it("does not mount the caret on a fully settled exchange", () => {
    const props = baseProps();
    const { container, root } = mount(
      <MessagesTimeline
        {...props}
        timelineEntries={[
          userEntry("message-1", "Question"),
          assistantEntry("assistant-1", "Final answer", false, null),
        ]}
      />,
    );

    expect(caretHooks(container)).toHaveLength(0);

    act(() => root.unmount());
  });
});

describe("MessagesTimeline tool completion flash (live DOM)", () => {
  it("arms the completion flash once when a running tool settles to success", () => {
    const props = baseProps();
    const turnId = TurnId.make("turn-tool");

    // First commit: the tool is in flight. This is recorded by the ledger.
    const { container, root } = mount(
      <MessagesTimeline
        {...props}
        activeTurnInProgress
        runningTurnId={turnId}
        latestTurn={{ turnId, state: "running", startedAt: AT, completedAt: null }}
        timelineEntries={[
          userEntry("message-1", "Run the tests"),
          workEntry({
            entryId: "work-updated",
            toolCallId: "call-1",
            status: "inProgress",
            turnId,
          }),
        ]}
      />,
    );

    // Running: the trace mounts, and nothing is flashing yet.
    expect(container.querySelector('[data-tool-status="running"]')).not.toBeNull();
    expect(container.querySelector(".conversation-tool-flash")).toBeNull();

    // The tool finishes *mid-turn* — the turn is still running, so the row is
    // still visible (it has not folded). This is the exact moment the flash
    // must fire. Crucially the work-log entry id is *different*
    // (`work-completed`) — the completion activity replaces it — while
    // `toolCallId` stays `call-1`. Keying the ledger on `toolCallId` is exactly
    // what lets this transition arm the flash; keying on `id` (the old bug)
    // never matched the running row against its own completion.
    act(() => {
      root.render(
        <MessagesTimeline
          {...props}
          activeTurnInProgress
          runningTurnId={turnId}
          latestTurn={{ turnId, state: "running", startedAt: AT, completedAt: null }}
          timelineEntries={[
            userEntry("message-1", "Run the tests"),
            workEntry({
              entryId: "work-completed",
              toolCallId: "call-1",
              status: "completed",
              turnId,
              detail: "Completed successfully",
            }),
          ]}
        />,
      );
    });

    expect(container.querySelector('[data-tool-status="success"]')).not.toBeNull();
    expect(container.querySelector(".conversation-tool-flash")).not.toBeNull();

    act(() => root.unmount());
  });
});

function morphBubbles(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-user-turn-arrival="true"]')];
}

// The flyer is a body-appended `position: fixed` node the send handler
// (`runSendMorphTransition`) BUILDS from the sent text — never the timeline
// component, and never a clone of the composer subtree. Its signature is
// `aria-hidden` + `inert`. Rendering the timeline must produce none of them, and
// no element must carry a `view-transition-name` (the whole View Transitions
// mechanism was deleted in favour of the built-flyer flight).
function strayFlyers(): Element[] {
  return [...document.body.querySelectorAll('[aria-hidden="true"][inert]')];
}

function viewTransitionNamed(container: HTMLElement): HTMLElement[] {
  // Unset is "" in a real browser and `undefined` in happy-dom — either way a
  // named element has a non-empty string here.
  return [...container.querySelectorAll<HTMLElement>("*")].filter(
    (el) =>
      typeof el.style.viewTransitionName === "string" && el.style.viewTransitionName.length > 0,
  );
}

// The morph motion is a rAF-driven built-flyer flight owned by the send handler.
// The timeline component's only job is to render the landing hook
// (`data-user-turn-arrival`) on exactly the just-sent bubble. It owns no
// `view-transition-name` and mounts nothing on `document.body`.
describe("MessagesTimeline send-morph landing hook (live DOM)", () => {
  it("hooks the just-sent bubble for the flight, once, never on history or replay", () => {
    const props = baseProps();

    // First commit is history: nothing arrives, so nothing carries the hook.
    const { container, root } = mount(
      <MessagesTimeline
        {...props}
        timelineEntries={[
          userEntry("message-1", "First question"),
          assistantEntry("assistant-1", "First answer", false, null),
        ]}
      />,
    );
    expect(morphBubbles(container)).toHaveLength(0);
    expect(viewTransitionNamed(container)).toHaveLength(0);
    expect(strayFlyers()).toHaveLength(0);

    // A new user message appears for the first time. This is the arrival the
    // ledger observes: the bubble is the sole landing hook for the flight.
    act(() => {
      root.render(
        <MessagesTimeline
          {...props}
          timelineEntries={[
            userEntry("message-1", "First question"),
            assistantEntry("assistant-1", "First answer", false, null),
            userEntry("message-2", "Second question"),
          ]}
        />,
      );
    });

    const arriving = morphBubbles(container);
    expect(arriving).toHaveLength(1);
    expect(arriving[0]?.classList.contains("conversation-user-arrival")).toBe(true);
    expect(arriving[0]?.textContent).toContain("Second question");
    // The row owns no view-transition-name (the deleted mechanism) and the
    // component mounts no flyer on the body.
    expect(viewTransitionNamed(container)).toHaveLength(0);
    expect(strayFlyers()).toHaveLength(0);

    // An unrelated re-render (the assistant starts streaming) must not re-arm
    // the hook on message-2, and message-1 never claims it.
    act(() => {
      root.render(
        <MessagesTimeline
          {...props}
          timelineEntries={[
            userEntry("message-1", "First question"),
            assistantEntry("assistant-1", "First answer", false, null),
            userEntry("message-2", "Second question"),
            assistantEntry("assistant-2", "", true, TurnId.make("turn-2")),
          ]}
        />,
      );
    });
    expect(morphBubbles(container).length).toBeLessThanOrEqual(1);
    expect(strayFlyers()).toHaveLength(0);

    act(() => root.unmount());
  });

  it("does not hook a bubble on history hydration (first snapshot is silent)", () => {
    const props = baseProps();

    // A thread opened with an existing user turn: it is history, not an arrival,
    // so it neither plays the CSS rise nor carries the landing hook.
    const { container, root } = mount(
      <MessagesTimeline
        {...props}
        timelineEntries={[
          userEntry("message-1", "Existing question"),
          assistantEntry("assistant-1", "Existing answer", false, null),
        ]}
      />,
    );

    expect(arrivalBubbles(container)).toHaveLength(0);
    expect(morphBubbles(container)).toHaveLength(0);
    expect(strayFlyers()).toHaveLength(0);

    act(() => root.unmount());
  });
});
