import { CheckIcon, ChevronsDownUpIcon, CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import {
  type ContextCompactionStatus,
  type ContextWindowSnapshot,
  formatContextWindowTokens,
} from "~/lib/contextWindow";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { usePinnedHoverPopover } from "./usePinnedHoverPopover";

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

export function ContextCompactAction(props: {
  disabled?: boolean;
  status?: ContextCompactionStatus | null;
  onCompact: () => Promise<boolean>;
}) {
  const isCompacting = props.status?.state === "compacting";
  const isCompleted = props.status?.state === "completed";
  const actionLabel =
    props.status?.state === "compacting"
      ? "Compacting\u2026"
      : props.status?.state === "completed"
        ? "Context compacted"
        : props.status?.state === "failed"
          ? "Compaction failed"
          : "Compact context";
  const actionAriaLabel = isCompleted
    ? "Context compacted. Send a message before compacting again"
    : props.status?.state === "failed"
      ? "Context compaction failed. Try again"
      : props.status?.state === "compacting"
        ? "Compacting context"
        : "Compact context now";
  const handleCompact = async () => {
    if (props.disabled || isCompacting || isCompleted) {
      return;
    }
    await props.onCompact();
  };

  return (
    <div className="mt-1 border-border/50 border-t pt-2" role="status" aria-live="polite">
      <Button
        size="sm"
        className={cn(
          "w-full justify-center transition-colors",
          isCompleted &&
            "border-primary/60 bg-primary/55 text-primary-foreground shadow-none disabled:bg-primary/55 disabled:opacity-100 disabled:hover:bg-primary/55",
          props.status?.state === "failed" &&
            "bg-destructive/15 text-destructive hover:bg-destructive/20",
        )}
        disabled={props.disabled || isCompacting || isCompleted}
        onClick={() => void handleCompact()}
        aria-label={actionAriaLabel}
      >
        <span className="flex items-center gap-1.5">
          {isCompacting ? (
            <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
          ) : props.status?.state === "completed" ? (
            <CheckIcon />
          ) : props.status?.state === "failed" ? (
            <CircleAlertIcon />
          ) : (
            <ChevronsDownUpIcon />
          )}
          {actionLabel}
        </span>
      </Button>
    </div>
  );
}

export function ContextWindowMeter(props: {
  usage: ContextWindowSnapshot;
  compactionStatus?: ContextCompactionStatus | null;
  providerDisplayName?: string | null;
  canCompact?: boolean;
  compactDisabled?: boolean;
  onCompact?: () => Promise<boolean>;
}) {
  const { usage, providerDisplayName } = props;
  const contextPopover = usePinnedHoverPopover();
  const [requestPending, setRequestPending] = useState(false);
  const statusAtRequestRef = useRef<string | null>(null);
  const compactionStatusKey = props.compactionStatus
    ? `${props.compactionStatus.state}:${props.compactionStatus.createdAt}`
    : null;
  const visibleCompactionStatus: ContextCompactionStatus | null = requestPending
    ? {
        state: "compacting",
        createdAt: props.compactionStatus?.createdAt ?? new Date().toISOString(),
      }
    : (props.compactionStatus ?? null);

  useEffect(() => {
    if (
      requestPending &&
      compactionStatusKey !== null &&
      compactionStatusKey !== statusAtRequestRef.current &&
      props.compactionStatus?.state !== "compacting"
    ) {
      setRequestPending(false);
    }
  }, [compactionStatusKey, props.compactionStatus?.state, requestPending]);

  const handleCompact = async (): Promise<boolean> => {
    statusAtRequestRef.current = compactionStatusKey;
    setRequestPending(true);
    const accepted = await props.onCompact?.();
    if (!accepted) {
      setRequestPending(false);
    }
    return accepted ?? false;
  };
  const usedPercentage = formatPercentage(usage.usedPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (normalizedPercentage / 100) * circumference;
  const totalProcessedTokens = usage.totalProcessedTokens ?? null;
  const showTotalProcessed = totalProcessedTokens !== null && totalProcessedTokens > 0;
  const isOverloaded = normalizedPercentage > 90;
  const usageColor = isOverloaded
    ? "var(--color-red-500)"
    : "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)";

  return (
    <Popover open={contextPopover.open} onOpenChange={contextPopover.onOpenChange}>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={100}
        render={
          <button
            type="button"
            className={cn(
              "inline-flex size-7 cursor-pointer items-center justify-center rounded-full border border-transparent text-muted-foreground outline-none transition-colors",
              "hover:bg-accent data-[pressed]:bg-accent",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            )}
            aria-label={`${
              usage.maxTokens !== null && usedPercentage
                ? `Context window ${usedPercentage} used`
                : `Context window ${formatContextWindowTokens(usage.usedTokens)} tokens used`
            }${
              visibleCompactionStatus?.state === "compacting"
                ? ", compacting context"
                : visibleCompactionStatus?.state === "completed"
                  ? ", context compacted"
                  : visibleCompactionStatus?.state === "failed"
                    ? ", context compaction failed"
                    : ""
            }`}
          >
            <span className="relative flex size-5 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="-rotate-90 absolute inset-0 size-full transform-gpu"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="color-mix(in oklab, var(--color-muted-foreground) 24%, transparent)"
                  strokeWidth="3"
                />
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke={usageColor}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
                />
              </svg>
            </span>
          </button>
        }
      />
      <PopoverPopup
        tooltipStyle
        side="top"
        align="end"
        className="dropdown-glass w-64 max-w-none border-0! bg-secondary! p-0 shadow-none! before:hidden"
      >
        <div className="flex flex-col gap-2 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-muted-foreground text-xs">Context Window</div>
            {usage.maxTokens !== null && usedPercentage ? (
              <div className="text-[11px] tabular-nums text-muted-foreground/70">
                <span>{usedPercentage}</span>
                <span className="mx-1">·</span>
                <span>
                  {formatContextWindowTokens(usage.usedTokens)}/
                  {formatContextWindowTokens(usage.maxTokens ?? null)}
                </span>
              </div>
            ) : (
              <div className="text-[11px] tabular-nums text-muted-foreground/70">
                {formatContextWindowTokens(usage.usedTokens)}
              </div>
            )}
          </div>
          {usage.maxTokens !== null ? (
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(normalizedPercentage)}
              aria-label="Context window usage"
            >
              <div
                className="h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none"
                style={{ width: `${normalizedPercentage}%`, backgroundColor: usageColor }}
              />
            </div>
          ) : null}
          {showTotalProcessed ? (
            <div className="flex items-center justify-between gap-3 text-[11px] leading-4">
              <span className="text-muted-foreground/60">Total processed</span>
              <span className="font-medium tabular-nums text-muted-foreground/80">
                {formatContextWindowTokens(totalProcessedTokens)}
              </span>
            </div>
          ) : null}
          {usage.compactsAutomatically ? (
            <div className="mt-1 text-pretty text-[11px] font-medium text-muted-foreground/70">
              {providerDisplayName ?? "It"} automatically compacts its context when needed.
            </div>
          ) : null}
          {props.canCompact && props.onCompact ? (
            <ContextCompactAction
              disabled={props.compactDisabled ?? false}
              status={visibleCompactionStatus}
              onCompact={handleCompact}
            />
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
