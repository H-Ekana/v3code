import {
  EnvironmentId,
  EventId,
  MessageId,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationThread,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadStreamItem,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";

import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as ConnectionWakeups from "../connection/wakeups.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as Persistence from "../platform/persistence.ts";
import * as RpcSession from "../rpc/session.ts";
import {
  EMPTY_ENVIRONMENT_THREAD_STATE,
  makeEnvironmentThreadState,
  ThreadSnapshotLoader,
  type EnvironmentThreadState,
} from "./threads.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const THREAD_ID = ThreadId.make("thread-1");
const CACHED_SNAPSHOT_SEQUENCE = 7;
const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: TARGET.httpBaseUrl,
  socketUrl: TARGET.wsBaseUrl,
  httpAuthorization: null,
  target: TARGET,
};
const BASE_THREAD: OrchestrationThread = {
  id: THREAD_ID,
  projectId: ProjectId.make("project-1"),
  title: "Cached thread",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "main",
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};
const ACTIVE_THREAD: OrchestrationThread = {
  ...BASE_THREAD,
  latestTurn: {
    turnId: TurnId.make("turn-1"),
    state: "running",
    requestedAt: "2026-04-01T00:01:00.000Z",
    startedAt: "2026-04-01T00:01:00.000Z",
    completedAt: null,
    assistantMessageId: null,
  },
  session: {
    threadId: THREAD_ID,
    status: "running",
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: TurnId.make("turn-1"),
    lastError: null,
    updatedAt: "2026-04-01T00:01:00.000Z",
  },
};

type TestThreadInput = OrchestrationThreadStreamItem | Error;

// Mirrors THREAD_STATE_PUBLISH_WINDOW in threads.ts.
const PUBLISH_WINDOW = "16 millis";

function testSession(
  client: WsRpcProtocolClient,
  options?: { readonly completionMarker?: boolean },
): RpcSession.RpcSession {
  return {
    client,
    initialConfig: Effect.succeed(
      options?.completionMarker === true
        ? ({ threadResumeCompletionMarker: true } as never)
        : ({} as never),
    ),
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
}

// Streaming updates are published on a ~16ms coalescing window, so an awaited
// state can be sitting in the coalescer with no runnable fiber left to release
// it. Advance the virtual clock, but only once the observer queue has gone
// genuinely idle, so tests that drive the retry backoff or the persistence
// debounce keep their own explicit control of those timers.
function awaitThreadState(
  observed: Queue.Queue<EnvironmentThreadState>,
  predicate: (state: EnvironmentThreadState) => boolean,
) {
  return Effect.gen(function* () {
    let idleRounds = 0;
    for (let round = 0; round < 500; round += 1) {
      const next = yield* Queue.poll(observed);
      if (Option.isSome(next)) {
        idleRounds = 0;
        if (predicate(next.value)) {
          return next.value;
        }
        continue;
      }
      for (let step = 0; step < 10; step += 1) {
        yield* Effect.yieldNow;
      }
      idleRounds += 1;
      if (idleRounds >= 2) {
        idleRounds = 0;
        yield* TestClock.adjust(PUBLISH_WINDOW);
      }
    }
    return yield* Effect.die(new Error("awaitThreadState: no state matched the predicate"));
  });
}

// Lets every runnable fiber drain without advancing the virtual clock, so the
// coalescing window stays open across the whole burst.
const settle = Effect.gen(function* () {
  for (let step = 0; step < 100; step += 1) {
    yield* Effect.yieldNow;
  }
});

function collectPublished(observed: Queue.Queue<EnvironmentThreadState>) {
  return Effect.gen(function* () {
    const published: Array<EnvironmentThreadState> = [];
    for (;;) {
      const next = yield* Queue.poll(observed);
      if (Option.isNone(next)) {
        return published;
      }
      published.push(next.value);
    }
  });
}

function latestMessageText(state: EnvironmentThreadState): string | undefined {
  return Option.getOrThrow(state.data).messages.at(-1)?.text;
}

const makeHarness = Effect.fn("TestEnvironmentThreads.makeHarness")(function* (options?: {
  readonly cached?: OrchestrationThread;
  readonly httpSnapshot?: Option.Option<OrchestrationThreadDetailSnapshot>;
  readonly completionMarker?: boolean;
}) {
  const inputs = yield* Queue.unbounded<TestThreadInput>();
  const observed = yield* Queue.unbounded<EnvironmentThreadState>();
  const latest = yield* Ref.make<EnvironmentThreadState>(EMPTY_ENVIRONMENT_THREAD_STATE);
  const retryCount = yield* Ref.make(0);
  const subscriptionCount = yield* Ref.make(0);
  const loaderCalls = yield* Ref.make(0);
  const lastSubscribeAfterSequence = yield* Ref.make<number | undefined>(undefined);
  const lastRequestCompletionMarker = yield* Ref.make<boolean | undefined>(undefined);
  const savedThreads = yield* Ref.make<ReadonlyArray<OrchestrationThreadDetailSnapshot>>([]);
  const removedThreads = yield* Ref.make<ReadonlyArray<ThreadId>>([]);
  const wakeups = yield* Queue.unbounded<ConnectionWakeups.ConnectionWakeup>();
  const supervisorState = yield* SubscriptionRef.make<SupervisorConnectionState>(
    AVAILABLE_CONNECTION_STATE,
  );
  const streamFrom = (queue: Queue.Queue<TestThreadInput>) =>
    Stream.fromQueue(queue).pipe(
      Stream.mapEffect((input) =>
        input instanceof Error ? Effect.fail(input) : Effect.succeed(input),
      ),
    );
  const client = {
    [ORCHESTRATION_WS_METHODS.subscribeThread]: (input: {
      readonly afterSequence?: number;
      readonly requestCompletionMarker?: boolean;
    }) =>
      Stream.unwrap(
        Ref.updateAndGet(subscriptionCount, (count) => count + 1).pipe(
          Effect.andThen(Ref.set(lastSubscribeAfterSequence, input.afterSequence)),
          Effect.andThen(Ref.set(lastRequestCompletionMarker, input.requestCompletionMarker)),
          Effect.as(streamFrom(inputs)),
        ),
      ),
  } as unknown as WsRpcProtocolClient;
  const supervisorSession = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(
    Option.some(
      testSession(
        client,
        options?.completionMarker === true ? { completionMarker: true } : undefined,
      ),
    ),
  );
  const prepared = yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(
    Option.some(PREPARED),
  );
  const snapshotLoader = ThreadSnapshotLoader.of({
    load: (_prepared, threadId) =>
      Ref.update(loaderCalls, (count) => count + 1).pipe(
        Effect.as(
          threadId === THREAD_ID
            ? (options?.httpSnapshot ?? Option.none<OrchestrationThreadDetailSnapshot>())
            : Option.none<OrchestrationThreadDetailSnapshot>(),
        ),
      ),
  });
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: supervisorState,
    session: supervisorSession,
    prepared,
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Ref.update(retryCount, (count) => count + 1),
  } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
  const cache = Persistence.EnvironmentCacheStore.of({
    loadShell: () => Effect.succeed(Option.none()),
    saveShell: () => Effect.void,
    loadThread: (_environmentId, threadId) =>
      Effect.succeed(
        threadId === THREAD_ID && options?.cached !== undefined
          ? Option.some({
              snapshotSequence: CACHED_SNAPSHOT_SEQUENCE,
              thread: options.cached,
            })
          : Option.none(),
      ),
    saveThread: (_environmentId, thread) =>
      Ref.update(savedThreads, (current) => [...current, thread]),
    removeThread: (_environmentId, threadId) =>
      Ref.update(removedThreads, (current) => [...current, threadId]),
    loadServerConfig: () => Effect.succeed(Option.none()),
    saveServerConfig: () => Effect.void,
    loadVcsRefs: () => Effect.succeed(Option.none()),
    saveVcsRefs: () => Effect.void,
    clear: () => Effect.void,
  });
  const threadState = yield* makeEnvironmentThreadState(THREAD_ID).pipe(
    Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    Effect.provideService(Persistence.EnvironmentCacheStore, cache),
    Effect.provideService(ThreadSnapshotLoader, snapshotLoader),
    Effect.provideService(
      ConnectionWakeups.ConnectionWakeups,
      ConnectionWakeups.ConnectionWakeups.of({ changes: Stream.fromQueue(wakeups) }),
    ),
  );
  yield* SubscriptionRef.changes(threadState).pipe(
    Stream.runForEach((state) =>
      Ref.set(latest, state).pipe(Effect.andThen(Queue.offer(observed, state))),
    ),
    Effect.forkScoped,
  );

  return {
    inputs,
    observed,
    latest,
    retryCount,
    subscriptionCount,
    loaderCalls,
    lastSubscribeAfterSequence,
    lastRequestCompletionMarker,
    supervisorState,
    supervisorSession,
    savedThreads,
    removedThreads,
    wakeups,
    replaceSession: SubscriptionRef.set(
      supervisorSession,
      Option.some(
        testSession(
          client,
          options?.completionMarker === true ? { completionMarker: true } : undefined,
        ),
      ),
    ),
  };
});

const snapshot = (thread: OrchestrationThread): OrchestrationThreadStreamItem => ({
  kind: "snapshot",
  snapshot: {
    snapshotSequence: 1,
    thread,
  },
});

const synchronized = (): OrchestrationThreadStreamItem => ({ kind: "synchronized" });

const titleUpdated = (title: string, sequence = 2): OrchestrationThreadStreamItem => ({
  kind: "event",
  event: {
    eventId: EventId.make("event-title"),
    sequence,
    occurredAt: "2026-04-01T01:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    type: "thread.meta-updated",
    payload: {
      threadId: THREAD_ID,
      title,
      updatedAt: "2026-04-01T01:00:00.000Z",
    },
  },
});

const assistantDelta = (text: string, sequence: number): OrchestrationThreadStreamItem => ({
  kind: "event",
  event: {
    eventId: EventId.make(`event-delta-${sequence}`),
    sequence,
    occurredAt: "2026-04-01T01:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    type: "thread.message-sent",
    payload: {
      threadId: THREAD_ID,
      messageId: MessageId.make("message-assistant"),
      role: "assistant",
      text,
      turnId: TurnId.make("turn-1"),
      streaming: true,
      createdAt: "2026-04-01T01:00:00.000Z",
      updatedAt: "2026-04-01T01:00:00.000Z",
    },
  },
});

const deleted = (sequence = 3): OrchestrationThreadStreamItem => ({
  kind: "event",
  event: {
    eventId: EventId.make("event-deleted"),
    sequence,
    occurredAt: "2026-04-01T02:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    type: "thread.deleted",
    payload: {
      threadId: THREAD_ID,
      deletedAt: "2026-04-01T02:00:00.000Z",
    },
  },
});

describe("EnvironmentThreads", () => {
  it.effect("publishes cached data immediately from a warm cache", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });
      const state = yield* awaitThreadState(harness.observed, (value) => Option.isSome(value.data));

      expect(Option.getOrThrow(state.data)).toEqual(BASE_THREAD);
      expect(Option.isNone(state.error)).toBe(true);
    }),
  );

  it.effect("resumes a warm cache via afterSequence without an HTTP fetch", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });

      // The warm cache reaches live from the cached data, and a live event
      // applies on top of it.
      yield* Queue.offer(harness.inputs, titleUpdated("Live title", CACHED_SNAPSHOT_SEQUENCE + 1));
      yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Live title",
      );

      // The subscription resumed from the cached sequence and never fetched the
      // full snapshot over HTTP.
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(CACHED_SNAPSHOT_SEQUENCE);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(0);
    }),
  );

  it.effect("reduces live events and persists the latest thread", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });
      yield* Queue.offer(harness.inputs, snapshot(BASE_THREAD));
      yield* Queue.offer(harness.inputs, titleUpdated("Live title"));

      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Live title",
      );
      yield* TestClock.adjust("500 millis");
      yield* Effect.yieldNow;

      expect(Option.getOrThrow(state.data).title).toBe("Live title");
      expect((yield* Ref.get(harness.savedThreads)).at(-1)?.thread.title).toBe("Live title");
      expect((yield* Ref.get(harness.savedThreads)).at(-1)?.snapshotSequence).toBe(2);
    }),
  );

  it.effect("does not persist active thread snapshots during streaming or teardown", () =>
    Effect.gen(function* () {
      const savedThreads = yield* Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* makeHarness({ cached: ACTIVE_THREAD });
          yield* awaitThreadState(
            harness.observed,
            (value) =>
              value.status === "live" &&
              Option.isSome(value.data) &&
              value.data.value.session?.status === "running",
          );

          yield* TestClock.adjust("500 millis");
          yield* Effect.yieldNow;

          expect(yield* Ref.get(harness.savedThreads)).toEqual([]);
          return harness.savedThreads;
        }),
      );

      expect(yield* Ref.get(savedThreads)).toEqual([]);
    }),
  );

  it.effect("seeds the thread from the HTTP snapshot and resumes live events", () =>
    Effect.gen(function* () {
      const httpThread: OrchestrationThread = { ...BASE_THREAD, title: "HTTP title" };
      const harness = yield* makeHarness({
        httpSnapshot: Option.some({ snapshotSequence: 1, thread: httpThread }),
      });
      // No socket snapshot is pushed; only a live event arrives over the socket.
      // It can only be applied if the HTTP snapshot already seeded the thread.
      yield* Queue.offer(harness.inputs, titleUpdated("Live title", 2));

      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Live title",
      );

      expect(Option.getOrThrow(state.data).title).toBe("Live title");
      // Cold cache: the full snapshot was loaded over HTTP and the socket
      // resumed from that snapshot's sequence.
      expect(yield* Ref.get(harness.loaderCalls)).toBeGreaterThanOrEqual(1);
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(1);
    }),
  );

  it.effect("ignores replayed thread events at or below the snapshot sequence", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });
      yield* Queue.offer(harness.inputs, snapshot(BASE_THREAD));
      yield* Queue.offer(harness.inputs, titleUpdated("Replayed title", 1));
      yield* Queue.offer(harness.inputs, titleUpdated("Live title", 2));

      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Live title",
      );

      expect(Option.getOrThrow(state.data).title).toBe("Live title");
    }),
  );

  it.effect("removes cached data when the thread is deleted", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });
      yield* Queue.offer(harness.inputs, snapshot(BASE_THREAD));
      yield* Queue.offer(harness.inputs, deleted());

      const state = yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "deleted",
      );

      expect(Option.isNone(state.data)).toBe(true);
      expect(yield* Ref.get(harness.removedThreads)).toEqual([THREAD_ID]);
    }),
  );

  it.effect("does not resurrect a deleted thread when the app returns to the foreground", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        cached: BASE_THREAD,
        completionMarker: true,
        httpSnapshot: Option.some({
          snapshotSequence: 4,
          thread: { ...BASE_THREAD, title: "Stale HTTP thread" },
        }),
      });
      yield* Queue.offer(harness.inputs, snapshot(BASE_THREAD));
      yield* Queue.offer(harness.inputs, deleted());
      yield* awaitThreadState(harness.observed, (value) => value.status === "deleted");

      expect(yield* Ref.get(harness.loaderCalls)).toBe(0);
      yield* Queue.offer(harness.wakeups, "application-active");
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(harness.subscriptionCount)) >= 2) break;
        yield* Effect.yieldNow;
      }

      const latest = yield* Ref.get(harness.latest);
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(2);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(0);
      expect(latest.status).toBe("deleted");
      expect(Option.isNone(latest.data)).toBe(true);
    }),
  );

  it.effect("preserves data after a domain failure and resumes on a replacement session", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });
      yield* Queue.offer(harness.inputs, snapshot(BASE_THREAD));
      yield* Queue.offer(harness.inputs, new Error("stream failed"));

      const state = yield* awaitThreadState(harness.observed, (value) =>
        Option.isSome(value.error),
      );

      expect(Option.getOrThrow(state.data)).toEqual(BASE_THREAD);
      expect(Option.getOrThrow(state.error)).toBe("stream failed");
      expect(yield* Ref.get(harness.retryCount)).toBe(0);

      yield* harness.replaceSession;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(harness.subscriptionCount)) >= 2) {
          break;
        }
        yield* Effect.yieldNow;
      }
      yield* Queue.offer(
        harness.inputs,
        snapshot({
          ...BASE_THREAD,
          title: "Recovered thread",
        }),
      );
      const recovered = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Recovered thread",
      );

      expect(Option.isNone(recovered.error)).toBe(true);
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(2);
    }),
  );

  it.effect("recovers from a transient domain failure without repeating the HTTP preload", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Queue.offer(harness.inputs, new Error("thread not found yet"));

      const failed = yield* awaitThreadState(harness.observed, (value) =>
        Option.isSome(value.error),
      );
      expect(Option.getOrThrow(failed.error)).toBe("thread not found yet");
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(1);

      yield* TestClock.adjust("250 millis");
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(harness.subscriptionCount)) >= 2) {
          break;
        }
        yield* Effect.yieldNow;
      }
      yield* Queue.offer(
        harness.inputs,
        snapshot({
          ...BASE_THREAD,
          title: "Materialized thread",
        }),
      );

      const recovered = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Materialized thread",
      );

      expect(Option.isNone(recovered.error)).toBe(true);
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(2);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(1);
      expect(yield* Ref.get(harness.retryCount)).toBe(0);
    }),
  );

  it.effect("does not overwrite a live snapshot when the supervisor becomes ready", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });
      yield* SubscriptionRef.set(harness.supervisorState, {
        desired: true,
        network: "online",
        phase: "connecting",
        stage: "synchronizing",
        attempt: 1,
        generation: 0,
        lastFailure: null,
        retryAt: null,
      });
      yield* Queue.offer(harness.inputs, snapshot(BASE_THREAD));
      yield* awaitThreadState(harness.observed, (value) => value.status === "live");

      yield* SubscriptionRef.set(harness.supervisorState, {
        desired: true,
        network: "online",
        phase: "connected",
        stage: null,
        attempt: 1,
        generation: 1,
        lastFailure: null,
        retryAt: null,
      });
      for (let index = 0; index < 10; index += 1) {
        yield* Effect.yieldNow;
      }

      expect((yield* Ref.get(harness.latest)).status).toBe("live");
    }),
  );

  it.effect("collapses persisted resume events and ignores replay below the hydrated cursor", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD, completionMarker: true });
      yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "synchronizing" && Option.isSome(value.data),
      );
      expect(yield* Ref.get(harness.lastRequestCompletionMarker)).toBe(true);
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(CACHED_SNAPSHOT_SEQUENCE);
      yield* collectPublished(harness.observed);

      // A defensive replay at/below the hydrated cursor is ignored. Newer
      // persisted events are reduced into the authoritative value, but none of
      // their intermediate states may publish as live activity.
      yield* Queue.offer(
        harness.inputs,
        titleUpdated("Already hydrated", CACHED_SNAPSHOT_SEQUENCE),
      );
      yield* Queue.offer(harness.inputs, titleUpdated("Catch-up 1", CACHED_SNAPSHOT_SEQUENCE + 1));
      yield* Queue.offer(harness.inputs, titleUpdated("Catch-up 2", CACHED_SNAPSHOT_SEQUENCE + 2));
      yield* settle;
      yield* TestClock.adjust(PUBLISH_WINDOW);
      yield* settle;

      const duringHydration = yield* collectPublished(harness.observed);
      expect(
        duringHydration.flatMap((value) =>
          Option.match(value.data, { onNone: () => [], onSome: (thread) => [thread.title] }),
        ),
      ).toEqual([]);
      expect(Option.getOrThrow((yield* Ref.get(harness.latest)).data).title).toBe(
        BASE_THREAD.title,
      );

      yield* Queue.offer(harness.inputs, synchronized());
      const hydrated = yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "live" && Option.isSome(value.data),
      );
      expect(Option.getOrThrow(hydrated.data).title).toBe("Catch-up 2");

      // Once hydration has committed, a genuinely new event still publishes.
      yield* Queue.offer(
        harness.inputs,
        titleUpdated("Actually live", CACHED_SNAPSHOT_SEQUENCE + 3),
      );
      const live = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Actually live",
      );
      expect(Option.getOrThrow(live.data).title).toBe("Actually live");
    }),
  );

  it.effect("resumes replacement sessions from the latest applied sequence", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD, completionMarker: true });
      yield* Queue.offer(
        harness.inputs,
        titleUpdated("Latest title", CACHED_SNAPSHOT_SEQUENCE + 1),
      );
      yield* Queue.offer(harness.inputs, synchronized());
      yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Latest title",
      );

      yield* harness.replaceSession;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(harness.subscriptionCount)) >= 2) break;
        yield* Effect.yieldNow;
      }

      expect(yield* Ref.get(harness.subscriptionCount)).toBe(2);
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(CACHED_SNAPSHOT_SEQUENCE + 1);
      expect((yield* Ref.get(harness.latest)).status).toBe("synchronizing");
    }),
  );

  it.effect("resubscribes on app foreground from the latest applied sequence", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD, completionMarker: true });
      yield* Queue.offer(
        harness.inputs,
        titleUpdated("Latest title", CACHED_SNAPSHOT_SEQUENCE + 1),
      );
      yield* Queue.offer(harness.inputs, synchronized());
      yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Latest title",
      );

      yield* Queue.offer(harness.wakeups, "application-active");
      const synchronizing = yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "synchronizing" && Option.isSome(value.data),
      );
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(harness.subscriptionCount)) >= 2) break;
        yield* Effect.yieldNow;
      }

      expect(synchronizing.status).toBe("synchronizing");
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(2);
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(CACHED_SNAPSHOT_SEQUENCE + 1);
      expect(yield* Ref.get(harness.lastRequestCompletionMarker)).toBe(true);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(0);

      yield* Queue.offer(harness.inputs, synchronized());
      const live = yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "live" && Option.isSome(value.data),
      );
      expect(Option.getOrThrow(live.data).title).toBe("Latest title");
    }),
  );

  // Regression: `onExpectedFailure` writes the error out of band from the item
  // stream. Any publication scheme must never let a preceding item land *after*
  // the failure and silently clear it.
  it.effect("keeps an out-of-band stream failure after the preceding snapshot applies", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });
      yield* Queue.offer(harness.inputs, snapshot({ ...BASE_THREAD, title: "Snapshot title" }));
      // Let the snapshot reach `applyItem` in its own chunk, but never advance
      // the virtual clock: any publication window is still open when the
      // out-of-band failure lands.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        yield* Effect.yieldNow;
      }
      yield* Queue.offer(harness.inputs, new Error("stream failed"));

      const failed = yield* awaitThreadState(harness.observed, (value) =>
        Option.isSome(value.error),
      );
      expect(Option.getOrThrow(failed.data).title).toBe("Snapshot title");
      expect(Option.getOrThrow(failed.error)).toBe("stream failed");

      // Nothing published afterwards may resurrect a pre-failure value.
      for (let attempt = 0; attempt < 50; attempt += 1) {
        yield* Effect.yieldNow;
      }
      const latest = yield* Ref.get(harness.latest);
      expect(Option.getOrThrow(latest.data).title).toBe("Snapshot title");
      expect(Option.getOrThrow(latest.error)).toBe("stream failed");
    }),
  );

  // The sharper form of the same regression: the failure is written while a
  // coalesced delta is still waiting on the window. Closing the window must not
  // clear the failure, and must not lose the delta either.
  it.effect("keeps an out-of-band stream failure written over a pending delta", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });
      yield* awaitThreadState(harness.observed, (value) => value.status === "live");

      yield* Queue.offer(harness.inputs, assistantDelta("Hello", CACHED_SNAPSHOT_SEQUENCE + 1));
      yield* settle;
      yield* collectPublished(harness.observed);
      expect(latestMessageText(yield* Ref.get(harness.latest))).toBeUndefined();

      yield* Queue.offer(harness.inputs, new Error("stream failed"));
      const failed = yield* awaitThreadState(harness.observed, (value) =>
        Option.isSome(value.error),
      );
      expect(Option.getOrThrow(failed.error)).toBe("stream failed");
      expect(latestMessageText(failed)).toBe("Hello");

      // Closing the window (repeatedly) must not undo the failure.
      for (let round = 0; round < 3; round += 1) {
        yield* TestClock.adjust(PUBLISH_WINDOW);
        yield* settle;
      }
      const latest = yield* Ref.get(harness.latest);
      expect(Option.getOrThrow(latest.error)).toBe("stream failed");
      expect(latestMessageText(latest)).toBe("Hello");
    }),
  );

  it.effect("publishes a burst of assistant deltas once, with the concatenated text", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });
      yield* awaitThreadState(harness.observed, (value) => value.status === "live");
      yield* settle;
      yield* collectPublished(harness.observed);

      const deltas = ["Hel", "lo ", "wor", "ld"];
      for (const [index, text] of deltas.entries()) {
        yield* Queue.offer(
          harness.inputs,
          assistantDelta(text, CACHED_SNAPSHOT_SEQUENCE + 1 + index),
        );
      }
      yield* settle;

      // Every delta has been applied, but the window has not elapsed.
      expect(yield* collectPublished(harness.observed)).toEqual([]);

      yield* TestClock.adjust(PUBLISH_WINDOW);
      yield* settle;

      const published = yield* collectPublished(harness.observed);
      expect(published).toHaveLength(1);
      expect(latestMessageText(published[0]!)).toBe("Hello world");
      expect(published[0]!.status).toBe("live");

      // The window closing again must not republish the same version.
      yield* TestClock.adjust(PUBLISH_WINDOW);
      yield* settle;
      expect(yield* collectPublished(harness.observed)).toEqual([]);
    }),
  );

  it.effect("never resurrects a thread deleted mid-stream", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });
      yield* awaitThreadState(harness.observed, (value) => value.status === "live");

      // A coalesced delta is still pending when the delete lands.
      yield* Queue.offer(harness.inputs, assistantDelta("Hel", CACHED_SNAPSHOT_SEQUENCE + 1));
      yield* settle;
      yield* collectPublished(harness.observed);
      yield* Queue.offer(harness.inputs, deleted(CACHED_SNAPSHOT_SEQUENCE + 2));

      const state = yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "deleted",
      );
      expect(Option.isNone(state.data)).toBe(true);
      expect(yield* Ref.get(harness.removedThreads)).toEqual([THREAD_ID]);

      // Later items, and every later window boundary, leave the thread deleted.
      yield* Queue.offer(harness.inputs, assistantDelta("lo", CACHED_SNAPSHOT_SEQUENCE + 3));
      yield* settle;
      yield* TestClock.adjust(PUBLISH_WINDOW);
      yield* settle;
      yield* TestClock.adjust(PUBLISH_WINDOW);
      yield* settle;

      for (const published of yield* collectPublished(harness.observed)) {
        expect(published.status).toBe("deleted");
        expect(Option.isNone(published.data)).toBe(true);
      }
      const latest = yield* Ref.get(harness.latest);
      expect(latest.status).toBe("deleted");
      expect(Option.isNone(latest.data)).toBe(true);
    }),
  );

  it.effect("flushes pending deltas with the synchronized transition", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD, completionMarker: true });
      yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "synchronizing" && Option.isSome(value.data),
      );
      yield* settle;
      yield* collectPublished(harness.observed);

      yield* Queue.offer(harness.inputs, assistantDelta("Hello", CACHED_SNAPSHOT_SEQUENCE + 1));
      yield* settle;
      expect(yield* collectPublished(harness.observed)).toEqual([]);

      yield* Queue.offer(harness.inputs, synchronized());
      yield* settle;

      const published = yield* collectPublished(harness.observed);
      expect(published).toHaveLength(1);
      expect(published[0]!.status).toBe("live");
      expect(latestMessageText(published[0]!)).toBe("Hello");

      yield* TestClock.adjust(PUBLISH_WINDOW);
      yield* settle;
      expect(yield* collectPublished(harness.observed)).toEqual([]);
    }),
  );

  it.effect("persists the latest unpublished value on teardown", () =>
    Effect.gen(function* () {
      const savedThreads = yield* Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* makeHarness({ cached: BASE_THREAD });
          yield* awaitThreadState(harness.observed, (value) => value.status === "live");

          yield* Queue.offer(
            harness.inputs,
            titleUpdated("Pending title", CACHED_SNAPSHOT_SEQUENCE + 1),
          );
          yield* settle;

          // Applied but deliberately never published.
          expect(Option.getOrThrow((yield* Ref.get(harness.latest)).data).title).toBe(
            "Cached thread",
          );
          expect(yield* Ref.get(harness.savedThreads)).toEqual([]);
          return harness.savedThreads;
        }),
      );

      const saved = yield* Ref.get(savedThreads);
      expect(saved.at(-1)?.thread.title).toBe("Pending title");
      expect(saved.at(-1)?.snapshotSequence).toBe(CACHED_SNAPSHOT_SEQUENCE + 1);
    }),
  );
});
