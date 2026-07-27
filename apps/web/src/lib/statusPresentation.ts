/**
 * Presentation-only status vocabulary.
 *
 * Domain components keep lifecycle state and icon components; pass the four
 * independent axes here, then render the returned label, map `iconRole` to an
 * accessible icon, map `colorRole` to the matching semantic theme color, and
 * apply `motionClass`. Set attention to `unseen-result` only for the first live
 * completion presentation so one-shot motion cannot replay on restored history.
 */

export type StatusActivity =
  | "queued"
  | "running"
  | "waiting"
  | "interrupted"
  | "complete"
  | "failed";
export type StatusAttention = "none" | "input-required" | "approval-required" | "unseen-result";
export type StatusOutcome = "neutral" | "success" | "warning" | "failure";
export type StatusPersistence = "active" | "idle-resumable" | "snoozed" | "settled";

export interface StatusAxes {
  activity: StatusActivity;
  attention: StatusAttention;
  outcome: StatusOutcome;
  persistence: StatusPersistence;
}

export type StatusIconRole =
  | "active"
  | "activity"
  | "queued"
  | "waiting"
  | "warning"
  | "check"
  | "stop"
  | "error"
  | "resume"
  | "settled"
  | "snoozed";

export type StatusColorRole = "primary" | "warning" | "success" | "destructive" | "muted";

export interface StatusPresentation {
  readonly label: string;
  readonly iconRole: StatusIconRole;
  readonly colorRole: StatusColorRole;
  readonly motionClass: string;
  readonly nextAction?: "Retry";
}

const FAILED: StatusPresentation = {
  label: "Failed — retry available",
  iconRole: "error",
  colorRole: "destructive",
  motionClass: "motion-destructive",
  nextAction: "Retry",
};

const INTERRUPTED: StatusPresentation = {
  label: "Interrupted",
  iconRole: "stop",
  colorRole: "muted",
  motionClass: "motion-resting",
};

const SETTLED: StatusPresentation = {
  label: "Settled",
  iconRole: "settled",
  colorRole: "muted",
  motionClass: "motion-resting",
};

const SNOOZED: StatusPresentation = {
  label: "Snoozed",
  iconRole: "snoozed",
  colorRole: "muted",
  motionClass: "motion-resting",
};

const RUNNING: StatusPresentation = {
  label: "Running",
  iconRole: "activity",
  colorRole: "primary",
  motionClass: "motion-pending",
};

const QUEUED: StatusPresentation = {
  label: "Queued",
  iconRole: "queued",
  colorRole: "muted",
  motionClass: "motion-resting",
};

const WAITING: Record<"approval-required" | "input-required" | "none", StatusPresentation> = {
  "approval-required": {
    label: "Waiting for approval",
    iconRole: "waiting",
    colorRole: "warning",
    motionClass: "motion-pending",
  },
  "input-required": {
    label: "Waiting for input",
    iconRole: "waiting",
    colorRole: "warning",
    motionClass: "motion-pending",
  },
  none: {
    label: "Waiting",
    iconRole: "waiting",
    colorRole: "warning",
    motionClass: "motion-pending",
  },
};

const IDLE_RESUMABLE: StatusPresentation = {
  label: "Ready to resume",
  iconRole: "resume",
  colorRole: "muted",
  motionClass: "motion-resting",
};

const ACTIVE: StatusPresentation = {
  label: "Active",
  iconRole: "active",
  colorRole: "muted",
  motionClass: "motion-resting",
};

function completedPresentation(status: StatusAxes): StatusPresentation {
  const colorRole =
    status.outcome === "success" ? "success" : status.outcome === "warning" ? "warning" : "muted";

  return {
    label: "Completed",
    iconRole: "check",
    colorRole,
    motionClass: status.attention === "unseen-result" ? "motion-completion" : "motion-resting",
  };
}

export function getStatusPresentation(status: StatusAxes): StatusPresentation {
  if (status.activity === "failed" || status.outcome === "failure") {
    return FAILED;
  }

  if (status.activity === "interrupted") {
    return INTERRUPTED;
  }

  if (status.persistence === "settled") {
    return SETTLED;
  }

  if (status.persistence === "snoozed") {
    return SNOOZED;
  }

  if (status.persistence === "idle-resumable") {
    return IDLE_RESUMABLE;
  }

  if (
    status.activity === "waiting" ||
    status.attention === "approval-required" ||
    status.attention === "input-required"
  ) {
    const reason =
      status.attention === "approval-required" || status.attention === "input-required"
        ? status.attention
        : "none";
    return WAITING[reason];
  }

  if (status.activity === "running") {
    return RUNNING;
  }

  if (status.activity === "queued") {
    return QUEUED;
  }

  if (status.activity === "complete") {
    return completedPresentation(status);
  }

  if (status.outcome === "warning") {
    return {
      label: "Warning",
      iconRole: "warning",
      colorRole: "warning",
      motionClass: "motion-resting",
    };
  }

  if (status.outcome === "success") {
    return {
      label: "Succeeded",
      iconRole: "check",
      colorRole: "success",
      motionClass: "motion-resting",
    };
  }

  return ACTIVE;
}
