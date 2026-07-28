import type { EnvironmentId } from "@t3tools/contracts";
import { CloudIcon, MonitorIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { cn } from "~/lib/utils";
import type { EnvironmentOption } from "./BranchToolbar.logic";
import { useConfirmedLabelCrossfade } from "./confirmedLabelCrossfade";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface BranchToolbarEnvironmentSelectorProps {
  envLocked: boolean;
  environmentId: EnvironmentId;
  availableEnvironments: readonly EnvironmentOption[];
  // Absent when there is only one environment to show: the indicator still
  // renders (as a static label) so remote projects are always identifiable.
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
}

export const BranchToolbarEnvironmentSelector = memo(function BranchToolbarEnvironmentSelector({
  envLocked,
  environmentId,
  availableEnvironments,
  onEnvironmentChange,
}: BranchToolbarEnvironmentSelectorProps) {
  const activeEnvironment = useMemo(() => {
    return availableEnvironments.find((env) => env.environmentId === environmentId) ?? null;
  }, [availableEnvironments, environmentId]);

  // `environmentId` is already the confirmed value — there is no optimistic
  // environment state — so the crossfade genuinely marks a landed change and
  // stays silent on first mount.
  const confirmedEnvironmentLabelKey = useConfirmedLabelCrossfade(environmentId);

  const environmentItems = useMemo(
    () =>
      availableEnvironments.map((env) => ({
        value: env.environmentId,
        label: env.label,
      })),
    [availableEnvironments],
  );

  if (envLocked || onEnvironmentChange === undefined) {
    return (
      <span className="inline-flex min-w-0 max-w-full items-center gap-1 border border-transparent px-[calc(--spacing(3)-1px)] text-sm font-medium text-muted-foreground/80 sm:text-xs">
        {activeEnvironment?.isPrimary ? (
          <MonitorIcon className="size-3 shrink-0" />
        ) : (
          <CloudIcon className="size-3 shrink-0" />
        )}
        <span
          className={cn(
            "truncate",
            confirmedEnvironmentLabelKey !== null && "feedback-label-crossfade",
          )}
          key={confirmedEnvironmentLabelKey ?? "confirmed-initial"}
        >
          {activeEnvironment?.label ?? "Run on"}
        </span>
      </span>
    );
  }

  return (
    <Select
      modal={false}
      value={environmentId}
      onValueChange={(value) => onEnvironmentChange(value as EnvironmentId)}
      items={environmentItems}
    >
      <SelectTrigger
        variant="ghost"
        size="xs"
        className="min-w-0 max-w-full font-medium text-muted-foreground/80 hover:text-foreground/95"
        aria-label="Run on"
      >
        {activeEnvironment?.isPrimary ? (
          <MonitorIcon className="size-3 shrink-0" />
        ) : (
          <CloudIcon className="size-3 shrink-0" />
        )}
        <span
          className={cn(
            "min-w-0 truncate",
            confirmedEnvironmentLabelKey !== null && "feedback-label-crossfade",
          )}
          key={confirmedEnvironmentLabelKey ?? "confirmed-initial"}
        >
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          <SelectGroupLabel>Run on</SelectGroupLabel>
          {availableEnvironments.map((env) => (
            <SelectItem key={env.environmentId} value={env.environmentId}>
              <span className="inline-flex items-center gap-1.5">
                {env.isPrimary ? (
                  <MonitorIcon className="size-3" />
                ) : (
                  <CloudIcon className="size-3" />
                )}
                {env.label}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
});
