import {
  ORCHESTRATION_WS_METHODS,
  type EnvironmentId as EnvironmentIdType,
  type OrchestrationThread,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadStreamItem,
  type ThreadId as ThreadIdType,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom } from "effect/unstable/reactivity";

import { EnvironmentRegistry } from "../connection/registry.ts";
import { connectionProjectionPhase } from "../connection/model.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import * as ConnectionWakeups from "../connection/wakeups.ts";
import { EnvironmentCacheStore } from "../platform/persistence.ts";
import { subscribeDynamic } from "../rpc/client.ts";
import { ThreadSnapshotLoader } from "./threadSnapshotHttp.ts";
import { parseThreadKey, threadKey } from "./entities.ts";
import { applyThreadDetailEvent } from "./threadReducer.ts";
import { THREAD_STATE_IDLE_TTL_MS } from "./threadRetention.ts";
import { followStreamInEnvironment } from "./runtime.ts";
import {
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentThreadState,
  type EnvironmentThreadStatus,
} from "./threadState.ts";

function statusWithoutLiveData(data: Option.Option<OrchestrationThread>): EnvironmentThreadStatus {
  return Option.isSome(data) ? "cached" : "empty";
}

function formatThreadError(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Could not synchronize the thread.";
}

function shouldPersistThread(thread: OrchestrationThread): boolean {
  const status = thread.session?.status;
  return status !== "starting" && status !== "running";
}

// Assistant deltas arrive many times per second. The reducer is cheap, so every
// item is still applied immediately and in order to the authoritative value
// below; only the *publication* of intermediate values to React is throttled to
// roughly one animation frame.
const THREAD_STATE_PUBLISH_WINDOW = "16 millis";

interface PendingThreadState {
  readonly value: EnvironmentThreadState;
  // Monotonic write counter. Publication compares versions rather than values
  // so a write that returns an identical object still publishes, preserving the
  // SubscriptionRef semantics consumers see today.
  readonly version: number;
}

export const makeEnvironmentThreadState = Effect.fn("EnvironmentThreadState.make")(function* (
  threadId: ThreadIdType,
) {
  const supervisor = yield* EnvironmentSupervisor;
  const cache = yield* EnvironmentCacheStore;
  const snapshotLoader = yield* ThreadSnapshotLoader;
  const wakeups = yield* Effect.serviceOption(ConnectionWakeups.ConnectionWakeups);
  const environmentId = supervisor.target.environmentId;
  const cached = yield* cache.loadThread(environmentId, threadId).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Could not load cached thread.").pipe(
        Effect.annotateLogs({
          environmentId,
          threadId,
          error: error.message,
        }),
        Effect.as(Option.none<OrchestrationThreadDetailSnapshot>()),
      ),
    ),
  );
  const cachedThread = Option.map(cached, (snapshot) => snapshot.thread);
  const initialState: EnvironmentThreadState = {
    data: cachedThread,
    status: statusWithoutLiveData(cachedThread),
    error: Option.none(),
  };
  const state = yield* SubscriptionRef.make<EnvironmentThreadState>(initialState);
  // Authoritative thread state. Every writer mutates this synchronously, in
  // call order, and every reader reads it, so the value sequence is identical
  // to publishing straight to `state`. Only intermediate publications are
  // skipped — a write can never be observed out of order, and an out-of-band
  // failure (`onExpectedFailure`) can never be undone by a stale buffered item
  // because by the time the failure is written every preceding item has already
  // been applied here.
  const pending = yield* Ref.make<PendingThreadState>({ value: initialState, version: 0 });
  const publishedVersion = yield* Ref.make(0);
  const publishWakeups = yield* Queue.sliding<void>(1);

  const readState = Ref.get(pending).pipe(Effect.map((current) => current.value));

  // The only writer of `state`. The read/decide/publish runs under the
  // SubscriptionRef's own permit, so concurrent flushes can never publish two
  // versions out of order.
  const publishState = SubscriptionRef.updateSomeEffect(state, () =>
    Effect.gen(function* () {
      const current = yield* Ref.get(pending);
      const lastPublished = yield* Ref.get(publishedVersion);
      if (current.version === lastPublished) {
        return Option.none<EnvironmentThreadState>();
      }
      yield* Ref.set(publishedVersion, current.version);
      return Option.some(current.value);
    }),
  );
  const requestPublish = Queue.offer(publishWakeups, undefined).pipe(Effect.asVoid);

  const writeState = (update: (current: EnvironmentThreadState) => EnvironmentThreadState) =>
    Ref.update(pending, (current) => ({
      value: update(current.value),
      version: current.version + 1,
    }));
  // Terminal and connection transitions publish immediately so failures and
  // deletions are never delayed by the coalescing window.
  const updateStateNow = (update: (current: EnvironmentThreadState) => EnvironmentThreadState) =>
    writeState(update).pipe(Effect.andThen(publishState));

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        yield* Queue.take(publishWakeups);
        yield* Effect.sleep(THREAD_STATE_PUBLISH_WINDOW);
        yield* publishState;
      }
    }),
  );
  // Seed the resume cursor from the cached snapshot so a warm cache can catch up
  // via `afterSequence` instead of re-downloading the full thread body.
  const lastSequence = yield* SubscriptionRef.make(
    Option.match(cached, { onNone: () => 0, onSome: (snapshot) => snapshot.snapshotSequence }),
  );
  const awaitingCompletion = yield* Ref.make(false);
  const httpSnapshotLoadAttempted = yield* Ref.make(false);
  const persistence = yield* Queue.sliding<OrchestrationThreadDetailSnapshot>(1);

  const persist = Effect.fn("EnvironmentThreadState.persist")(function* (
    snapshot: OrchestrationThreadDetailSnapshot,
  ) {
    yield* cache.saveThread(environmentId, snapshot).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not persist the thread cache.").pipe(
          Effect.annotateLogs({
            environmentId,
            threadId,
            error: error.message,
          }),
        ),
      ),
    );
  });

  yield* Stream.fromQueue(persistence).pipe(
    Stream.debounce("500 millis"),
    Stream.runForEach(persist),
    Effect.forkScoped,
  );

  const setSynchronizing = updateStateNow((current) =>
    current.status === "deleted"
      ? current
      : {
          ...current,
          status: "synchronizing" as const,
          error: Option.none(),
        },
  );
  const setReady = updateStateNow((current) =>
    current.status === "live" || current.status === "deleted"
      ? current
      : {
          ...current,
          status: "synchronizing" as const,
          error: Option.none(),
        },
  );
  const setDisconnected = Effect.gen(function* () {
    yield* Ref.set(awaitingCompletion, false);
    yield* updateStateNow((current) => ({
      ...current,
      status: current.status === "deleted" ? current.status : statusWithoutLiveData(current.data),
    }));
  });
  const setStreamError = (cause: Cause.Cause<unknown>) =>
    Ref.set(awaitingCompletion, false).pipe(
      Effect.andThen(
        // `subscribeDynamic` reports expected failures out of band from the item
        // stream, so this must flush immediately: it is written after every
        // preceding item has been applied, and nothing may publish over it.
        updateStateNow((current) => ({
          ...current,
          status:
            current.status === "deleted" ? current.status : statusWithoutLiveData(current.data),
          error: Option.some(formatThreadError(cause)),
        })),
      ),
    );

  const setThread = Effect.fn("EnvironmentThreadState.setThread")(function* (
    thread: OrchestrationThread,
    options: { readonly publish: "immediate" | "coalesced" | "deferred" },
  ) {
    const waiting = yield* Ref.get(awaitingCompletion);
    yield* writeState(() => ({
      data: Option.some(thread),
      status: waiting ? "synchronizing" : "live",
      error: Option.none(),
    }));
    if (options.publish === "immediate") {
      yield* publishState;
    } else if (options.publish === "coalesced") {
      yield* requestPublish;
    }
    // Active threads can update many times per second and retain large tool
    // payloads. The server remains the source of truth while a turn is active;
    // persist once it settles so cache encoding stays off the streaming path.
    if (shouldPersistThread(thread)) {
      const snapshotSequence = yield* SubscriptionRef.get(lastSequence);
      yield* Queue.offer(persistence, { snapshotSequence, thread });
    }
  });

  const setDeleted = Effect.fn("EnvironmentThreadState.setDeleted")(function* () {
    yield* Ref.set(awaitingCompletion, false);
    yield* updateStateNow(() => ({
      data: Option.none(),
      status: "deleted",
      error: Option.none(),
    }));
    yield* cache.removeThread(environmentId, threadId).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not remove the cached thread.").pipe(
          Effect.annotateLogs({
            environmentId,
            threadId,
            error: error.message,
          }),
        ),
      ),
    );
  });

  const applyItem = Effect.fn("EnvironmentThreadState.applyItem")(function* (
    item: OrchestrationThreadStreamItem,
  ) {
    if (item.kind === "synchronized") {
      yield* Ref.set(awaitingCompletion, false);
      yield* updateStateNow((current) =>
        Option.isSome(current.data) && current.status !== "deleted"
          ? { ...current, status: "live" as const, error: Option.none() }
          : current,
      );
      return;
    }

    if (item.kind === "snapshot") {
      yield* SubscriptionRef.set(lastSequence, item.snapshot.snapshotSequence);
      yield* setThread(item.snapshot.thread, { publish: "immediate" });
      return;
    }

    const sequence = yield* SubscriptionRef.get(lastSequence);
    if (item.event.sequence <= sequence) {
      return;
    }
    yield* SubscriptionRef.set(lastSequence, item.event.sequence);

    const current = yield* readState;
    if (Option.isNone(current.data)) {
      if (item.event.type === "thread.deleted") {
        yield* setDeleted();
      }
      return;
    }
    const result = applyThreadDetailEvent(current.data.value, item.event);
    if (result.kind === "updated") {
      const waiting = yield* Ref.get(awaitingCompletion);
      // Persisted catch-up is authoritative state hydration, not live activity.
      // Reduce it immediately so the resume cursor stays current, but publish
      // only once when the synchronized marker arrives. Genuine post-marker
      // streaming keeps the existing frame-window coalescing.
      yield* setThread(result.thread, {
        publish: waiting ? "deferred" : "coalesced",
      });
    } else if (result.kind === "deleted") {
      yield* setDeleted();
    }
  });

  yield* SubscriptionRef.changes(supervisor.state).pipe(
    Stream.runForEach((connectionState) => {
      switch (connectionProjectionPhase(connectionState)) {
        case "synchronizing":
          return setSynchronizing;
        case "disconnected":
          return setDisconnected;
        case "ready":
          return setReady;
      }
    }),
    Effect.forkScoped,
  );

  const foregroundResubscriptions = Option.match(wakeups, {
    onNone: () => Stream.never,
    onSome: (service) =>
      service.changes.pipe(Stream.filter((reason) => reason === "application-active")),
  });

  yield* setSynchronizing;
  yield* Effect.forkScoped(
    subscribeDynamic(
      ORCHESTRATION_WS_METHODS.subscribeThread,
      Effect.fn("EnvironmentThreadState.makeSubscribeInput")(function* (session) {
        const supportsCompletionMarker = yield* session.initialConfig.pipe(
          Effect.map((config) => config.threadResumeCompletionMarker === true),
          Effect.orElseSucceed(() => false),
        );
        yield* Ref.set(awaitingCompletion, supportsCompletionMarker);
        yield* setSynchronizing;

        let current = yield* readState;
        if (Option.isNone(current.data) && current.status !== "deleted") {
          const alreadyAttempted = yield* Ref.getAndSet(httpSnapshotLoadAttempted, true);
          if (!alreadyAttempted) {
            const prepared = yield* SubscriptionRef.get(supervisor.prepared).pipe(
              Effect.flatMap(
                Option.match({
                  onSome: Effect.succeed,
                  onNone: () =>
                    SubscriptionRef.changes(supervisor.prepared).pipe(
                      Stream.filter(Option.isSome),
                      Stream.map((value) => value.value),
                      Stream.runHead,
                      Effect.map(Option.getOrThrow),
                    ),
                }),
              ),
            );
            const httpSnapshot = yield* snapshotLoader.load(prepared, threadId);
            if (Option.isSome(httpSnapshot)) {
              yield* applyItem({ kind: "snapshot", snapshot: httpSnapshot.value });
              current = yield* readState;
            }
          }
        }

        const sequence = yield* SubscriptionRef.get(lastSequence);
        const canResume = Option.isSome(current.data);
        if (!supportsCompletionMarker && canResume) {
          yield* updateStateNow((value) => ({
            ...value,
            status: value.status === "deleted" ? value.status : ("live" as const),
            error: Option.none(),
          }));
        }

        return {
          threadId,
          ...(canResume ? { afterSequence: sequence } : {}),
          ...(supportsCompletionMarker ? { requestCompletionMarker: true as const } : {}),
        };
      }),
      {
        onExpectedFailure: setStreamError,
        retryExpectedFailureAfter: "250 millis",
        resubscribe: foregroundResubscriptions,
      },
    ).pipe(Stream.runForEach(applyItem)),
  );

  yield* Effect.addFinalizer(() =>
    // Teardown must never persist a stale thread: flush whatever is still
    // waiting on the coalescing window, then read the authoritative value
    // rather than the last published one.
    publishState.pipe(
      Effect.andThen(Effect.all([readState, SubscriptionRef.get(lastSequence)])),
      Effect.flatMap(([current, snapshotSequence]) =>
        Option.match(current.data, {
          onNone: () => Effect.void,
          onSome: (thread) =>
            shouldPersistThread(thread) ? persist({ snapshotSequence, thread }) : Effect.void,
        }),
      ),
    ),
  );

  return state;
});

export function threadStateChanges(environmentId: EnvironmentIdType, threadId: ThreadIdType) {
  return followStreamInEnvironment(
    environmentId,
    Stream.unwrap(makeEnvironmentThreadState(threadId).pipe(Effect.map(SubscriptionRef.changes))),
  );
}

export function createEnvironmentThreadStateAtoms<R, E>(
  runtime: Atom.AtomRuntime<
    EnvironmentRegistry | EnvironmentCacheStore | ThreadSnapshotLoader | R,
    E
  >,
) {
  const family = Atom.family((key: string) => {
    const { environmentId, threadId } = parseThreadKey(key);
    return runtime
      .atom(threadStateChanges(environmentId, threadId), {
        initialValue: EMPTY_ENVIRONMENT_THREAD_STATE,
      })
      .pipe(
        Atom.setIdleTTL(THREAD_STATE_IDLE_TTL_MS),
        Atom.withLabel(`environment-thread-state:${key}`),
      );
  });

  return {
    stateAtom: (environmentId: EnvironmentIdType, threadId: ThreadIdType) =>
      family(threadKey({ environmentId, threadId })),
  };
}

export * from "./archivedThreads.ts";
export * from "./checkpointDiff.ts";
export * from "./threadSnapshotHttp.ts";
export * from "./composerPathSearch.ts";
export * from "./threadCommands.ts";
export * from "./threadDetail.ts";
export * from "./threadReducer.ts";
export * from "./threadShell.ts";
export * from "./threadState.ts";
