import type {
  OrchestrationMessage,
  OrchestrationThreadActivity,
  ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

type NullableContextWindowUsage = {
  readonly [Key in keyof ThreadTokenUsageSnapshot]: undefined extends ThreadTokenUsageSnapshot[Key]
    ? Exclude<ThreadTokenUsageSnapshot[Key], undefined> | null
    : ThreadTokenUsageSnapshot[Key];
};

export type ContextWindowSnapshot = NullableContextWindowUsage & {
  readonly remainingTokens: number | null;
  readonly usedPercentage: number | null;
  readonly remainingPercentage: number | null;
  readonly updatedAt: string;
};

export type ContextCompactionStatus = {
  readonly state: "compacting" | "completed" | "failed";
  readonly createdAt: string;
};

export function deriveLatestContextCompactionStatus(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ContextCompactionStatus | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity) continue;

    if (activity.kind === "context-compaction.started") {
      return { state: "compacting", createdAt: activity.createdAt };
    }
    if (activity.kind === "context-compaction") {
      return { state: "completed", createdAt: activity.createdAt };
    }
    if (activity.kind === "provider.context.compact.failed") {
      return { state: "failed", createdAt: activity.createdAt };
    }
  }
  return null;
}

export function deriveVisibleContextCompactionStatus(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  messages: ReadonlyArray<Pick<OrchestrationMessage, "role" | "createdAt">>,
): ContextCompactionStatus | null {
  const status = deriveLatestContextCompactionStatus(activities);
  if (status?.state !== "completed") {
    return status;
  }

  const completedAt = Date.parse(status.createdAt);
  const hasUserMessageAfterCompletion = messages.some((message) => {
    if (message.role !== "user") {
      return false;
    }
    const messageCreatedAt = Date.parse(message.createdAt);
    return Number.isFinite(completedAt) && Number.isFinite(messageCreatedAt)
      ? messageCreatedAt > completedAt
      : message.createdAt > status.createdAt;
  });

  return hasUserMessageAfterCompletion ? null : status;
}

export function providerSupportsManualContextCompaction(
  provider:
    | {
        readonly driver: string;
        readonly slashCommands: ReadonlyArray<{ readonly name: string }>;
      }
    | null
    | undefined,
): boolean {
  return (
    provider?.driver === "codex" ||
    provider?.driver === "grok" ||
    provider?.slashCommands.some((command) => command.name.trim().toLowerCase() === "compact") ===
      true
  );
}

/** Map a provider driver kind to a user-facing display name. */
export function formatProviderDisplayName(provider: string | null | undefined): string {
  if (!provider) return "This agent";
  switch (provider) {
    case "claudeAgent":
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "cursor":
      return "Cursor";
    case "opencode":
      return "OpenCode";
    default: {
      // Title-case unknown driver kinds so they read reasonably.
      const trimmed = provider.replace(/Agent$/i, "").trim();
      if (trimmed.length === 0) return provider;
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }
  }
}

export function deriveLatestContextWindowSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ContextWindowSnapshot | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.kind !== "context-window.updated") {
      continue;
    }

    const payload = asRecord(activity.payload);
    const usedTokens = asFiniteNumber(payload?.usedTokens);
    if (usedTokens === null || usedTokens < 0) {
      continue;
    }

    const maxTokens = asFiniteNumber(payload?.maxTokens);
    const usedPercentage =
      maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null;
    const remainingTokens =
      maxTokens !== null ? Math.max(0, Math.round(maxTokens - usedTokens)) : null;
    const remainingPercentage = usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null;

    return {
      usedTokens,
      totalProcessedTokens: asFiniteNumber(payload?.totalProcessedTokens),
      maxTokens,
      remainingTokens,
      usedPercentage,
      remainingPercentage,
      inputTokens: asFiniteNumber(payload?.inputTokens),
      cachedInputTokens: asFiniteNumber(payload?.cachedInputTokens),
      outputTokens: asFiniteNumber(payload?.outputTokens),
      reasoningOutputTokens: asFiniteNumber(payload?.reasoningOutputTokens),
      lastUsedTokens: asFiniteNumber(payload?.lastUsedTokens),
      lastInputTokens: asFiniteNumber(payload?.lastInputTokens),
      lastCachedInputTokens: asFiniteNumber(payload?.lastCachedInputTokens),
      lastOutputTokens: asFiniteNumber(payload?.lastOutputTokens),
      lastReasoningOutputTokens: asFiniteNumber(payload?.lastReasoningOutputTokens),
      toolUses: asFiniteNumber(payload?.toolUses),
      durationMs: asFiniteNumber(payload?.durationMs),
      compactsAutomatically: asBoolean(payload?.compactsAutomatically) ?? false,
      updatedAt: activity.createdAt,
    };
  }

  return null;
}

export function formatContextWindowTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "0";
  }
  if (value < 1_000) {
    return `${Math.round(value)}`;
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (value < 1_000_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}
