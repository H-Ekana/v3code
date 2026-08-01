import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import type {
  ProviderInstanceId,
  TextGenerationUsageOperation,
  TextGenerationUsageResult,
  TextGenerationUsageWindow,
} from "@t3tools/contracts";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ServerConfig from "../config.ts";
import { estimateCostUsd } from "./pricing.ts";

const USAGE_FILE = "text-generation-usage.json";

/**
 * On-disk shape. Deliberately NOT the settings file: this is mutable
 * telemetry, and settings should stay a user-authored document.
 */
const PersistedEntry = Schema.Struct({
  /** Local calendar day, YYYY-MM-DD. Rows are per-day so any window can be
   * aggregated later without having thrown history away. */
  day: Schema.String,
  instanceId: Schema.String,
  model: Schema.String,
  operation: Schema.String,
  calls: Schema.Number,
  succeededCalls: Schema.Number,
  /** null = the provider never reported tokens, which is not the same as 0. */
  inputTokens: Schema.NullOr(Schema.Number),
  cachedInputTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
  lastUsedAt: Schema.NullOr(Schema.String),
});

type PersistedUsage = {
  readonly version: number;
  readonly since: string | null;
  readonly entries: ReadonlyArray<typeof PersistedEntry.Type>;
};

const EMPTY: PersistedUsage = { version: 1, since: null, entries: [] };

/**
 * Plain JSON rather than Schema decoding: this file is our own telemetry, a
 * corrupt one already falls back to empty, and Schema's decoding services
 * would drag extra requirements into the layer for no benefit.
 */
function parsePersisted(raw: string): PersistedUsage {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") return EMPTY;
  const candidate = parsed as { since?: unknown; entries?: unknown };
  if (!Array.isArray(candidate.entries)) return EMPTY;
  return {
    version: 1,
    since: typeof candidate.since === "string" ? candidate.since : null,
    entries: candidate.entries as PersistedUsage["entries"],
  };
}

export interface RecordUsageInput {
  readonly instanceId: string;
  readonly model: string;
  readonly operation: TextGenerationUsageOperation;
  /** True when the call produced usable output. */
  readonly succeeded: boolean;
  /** Uncached input tokens; null when the provider reports nothing. */
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  /** ISO timestamp; passed in so the store stays deterministic in tests. */
  readonly at: string;
}

const entryKey = (day: string, instanceId: string, model: string, operation: string) =>
  `${day}::${instanceId}::${model}::${operation}`;

/**
 * Calendar day (UTC) for an ISO timestamp. Deliberately string arithmetic:
 * `Date` is banned in Effect code here, and UTC days keep the buckets stable
 * regardless of where the server runs.
 */
export function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/** Days since 1970-01-01 for a YYYY-MM-DD string (Howard Hinnant's algorithm). */
function daysFromCivil(day: string): number {
  const [yearPart, monthPart, dayPart] = day.split("-");
  const y0 = Number(yearPart);
  const m = Number(monthPart);
  const d = Number(dayPart);
  const y = y0 - (m <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of {@link daysFromCivil}. */
function civilFromDays(days: number): string {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  const year = y + (m <= 2 ? 1 : 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(m)}-${pad(d)}`;
}

/** Inclusive earliest day for a window, or null for "everything". */
export function windowStartDay(window: TextGenerationUsageWindow, now: string): string | null {
  const today = dayOf(now);
  const shift = (days: number) => civilFromDays(daysFromCivil(today) - days);
  switch (window) {
    case "today":
      return today;
    case "yesterday":
      return shift(1);
    case "last7Days":
      return shift(6);
    case "last30Days":
      return shift(29);
    case "lastYear":
      return shift(364);
    case "allTime":
      return null;
  }
}

/** Windows other than "yesterday" run up to today. */
export function windowEndDay(window: TextGenerationUsageWindow, now: string): string | null {
  return window === "yesterday" ? windowStartDay(window, now) : dayOf(now);
}

/** Pure reducer — the merge rules live here so they can be tested directly. */
export function mergeUsage(current: PersistedUsage, input: RecordUsageInput): PersistedUsage {
  const day = dayOf(input.at);
  const targetKey = entryKey(day, input.instanceId, input.model, input.operation);

  // Only a reported number contributes. null + 5 = 5; null + null stays null,
  // so "never reported" never silently becomes zero.
  const addTokens = (existing: number | null, incoming: number | null): number | null =>
    incoming === null ? existing : (existing ?? 0) + incoming;

  let found = false;
  const entries = current.entries.map((entry) => {
    if (entryKey(entry.day, entry.instanceId, entry.model, entry.operation) !== targetKey) {
      return entry;
    }
    found = true;
    return {
      ...entry,
      calls: entry.calls + 1,
      succeededCalls: entry.succeededCalls + (input.succeeded ? 1 : 0),
      inputTokens: addTokens(entry.inputTokens, input.inputTokens),
      cachedInputTokens: addTokens(entry.cachedInputTokens, input.cachedInputTokens),
      outputTokens: addTokens(entry.outputTokens, input.outputTokens),
      lastUsedAt: input.at,
    };
  });

  if (!found) {
    entries.push({
      day,
      instanceId: input.instanceId,
      model: input.model,
      operation: input.operation,
      calls: 1,
      succeededCalls: input.succeeded ? 1 : 0,
      inputTokens: input.inputTokens,
      cachedInputTokens: input.cachedInputTokens,
      outputTokens: input.outputTokens,
      lastUsedAt: input.at,
    });
  }

  return { version: 1, since: current.since ?? input.at, entries };
}

/**
 * Aggregate the per-day rows for one window into the API shape, pricing as we
 * go. Rows outside the window are left untouched on disk — switching windows
 * is a read, never a mutation.
 */
export function toUsageResult(
  stored: PersistedUsage,
  window: TextGenerationUsageWindow,
  now: string,
): TextGenerationUsageResult {
  const startDay = windowStartDay(window, now);
  const endDay = windowEndDay(window, now);
  const inWindow = stored.entries.filter((entry) => {
    if (startDay !== null && entry.day < startDay) return false;
    if (endDay !== null && entry.day > endDay) return false;
    return true;
  });

  // Collapse days into one row per (instance, model, operation).
  const grouped = new Map<string, (typeof inWindow)[number]>();
  for (const entry of inWindow) {
    const key = `${entry.instanceId}::${entry.model}::${entry.operation}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...entry });
      continue;
    }
    const add = (a: number | null, b: number | null): number | null =>
      a === null && b === null ? null : (a ?? 0) + (b ?? 0);
    grouped.set(key, {
      ...existing,
      calls: existing.calls + entry.calls,
      succeededCalls: existing.succeededCalls + entry.succeededCalls,
      inputTokens: add(existing.inputTokens, entry.inputTokens),
      cachedInputTokens: add(existing.cachedInputTokens, entry.cachedInputTokens),
      outputTokens: add(existing.outputTokens, entry.outputTokens),
      lastUsedAt:
        (entry.lastUsedAt ?? "") > (existing.lastUsedAt ?? "")
          ? entry.lastUsedAt
          : existing.lastUsedAt,
    });
  }

  const entries = [...grouped.values()].map((entry) => ({
    instanceId: entry.instanceId as ProviderInstanceId,
    model: entry.model,
    operation: entry.operation as TextGenerationUsageOperation,
    calls: entry.calls,
    succeededCalls: entry.succeededCalls,
    inputTokens: entry.inputTokens,
    cachedInputTokens: entry.cachedInputTokens,
    outputTokens: entry.outputTokens,
    estimatedCostUsd: estimateCostUsd({
      model: entry.model,
      inputTokens: entry.inputTokens,
      cachedInputTokens: entry.cachedInputTokens,
      outputTokens: entry.outputTokens,
    }),
    lastUsedAt: entry.lastUsedAt,
  }));

  const priced = entries.filter((entry) => entry.estimatedCostUsd !== null);
  const earliestDay = stored.entries.reduce<string | null>(
    (earliest, entry) => (earliest === null || entry.day < earliest ? entry.day : earliest),
    null,
  );
  return {
    window,
    entries,
    totalEstimatedCostUsd:
      priced.length === 0
        ? null
        : priced.reduce((total, entry) => total + (entry.estimatedCostUsd ?? 0), 0),
    hasUnpricedUsage: entries.some((entry) => entry.estimatedCostUsd === null),
    hasUnreportedTokens: entries.some(
      (entry) =>
        entry.inputTokens === null &&
        entry.cachedInputTokens === null &&
        entry.outputTokens === null,
    ),
    since: earliestDay,
  } satisfies TextGenerationUsageResult;
}

export class TextGenerationUsageStore extends Context.Service<
  TextGenerationUsageStore,
  {
    readonly record: (input: RecordUsageInput) => Effect.Effect<void>;
    readonly read: (window: TextGenerationUsageWindow) => Effect.Effect<TextGenerationUsageResult>;
    readonly reset: Effect.Effect<void>;
  }
>()("t3/promptSuggestion/usageStore/TextGenerationUsageStore") {}

/**
 * Record without requiring the store to be provided. Usage reporting must
 * never be able to break a generation, so a missing layer is a no-op.
 */
export const recordUsageIfAvailable = (input: RecordUsageInput) =>
  Effect.serviceOption(TextGenerationUsageStore).pipe(
    Effect.flatMap((store) => (store._tag === "Some" ? store.value.record(input) : Effect.void)),
    Effect.ignore,
  );

export const layer = Layer.effect(
  TextGenerationUsageStore,
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const filePath = path.join(serverConfig.stateDir, USAGE_FILE);

    // A missing or corrupt tally is not worth failing a request over.
    const loaded = yield* fs.readFileString(filePath).pipe(
      Effect.map(parsePersisted),
      Effect.orElseSucceed(() => EMPTY),
    );
    const state = yield* Ref.make(loaded);

    // The service surface promises no requirements, so the platform services
    // captured here are provided back into every write.
    const persist = (next: PersistedUsage) =>
      writeFileStringAtomically({ filePath, contents: JSON.stringify(next) }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.ignore,
      );

    return {
      record: (input) =>
        Ref.updateAndGet(state, (current) => mergeUsage(current, input)).pipe(
          Effect.flatMap(persist),
        ),
      read: (window) =>
        Effect.gen(function* () {
          const now = yield* DateTime.now;
          const stored = yield* Ref.get(state);
          return toUsageResult(stored, window, DateTime.formatIso(now));
        }),
      reset: Ref.set(state, EMPTY).pipe(Effect.andThen(persist(EMPTY))),
    };
  }),
);
