import { describe, expect, it } from "vite-plus/test";

import {
  getStatusPresentation,
  type StatusActivity,
  type StatusAttention,
  type StatusOutcome,
  type StatusPersistence,
} from "./statusPresentation";

const baseStatus = {
  activity: "running",
  attention: "none",
  outcome: "neutral",
  persistence: "active",
} as const;

describe("getStatusPresentation", () => {
  it("presents running as labeled violet activity", () => {
    expect(getStatusPresentation(baseStatus)).toEqual({
      label: "Running",
      iconRole: "activity",
      colorRole: "primary",
      motionClass: "motion-pending",
    });
  });

  it("keeps queued work explicit and quiet", () => {
    expect(getStatusPresentation({ ...baseStatus, activity: "queued" })).toMatchObject({
      label: "Queued",
      iconRole: "queued",
      colorRole: "muted",
      motionClass: "motion-resting",
    });
  });

  it.each([
    ["approval-required", "Waiting for approval"],
    ["input-required", "Waiting for input"],
    ["none", "Waiting"],
  ] as const)("keeps waiting for %s explicit", (attention, label) => {
    expect(getStatusPresentation({ ...baseStatus, activity: "waiting", attention })).toMatchObject({
      label,
      iconRole: "waiting",
      colorRole: "warning",
    });
  });

  it("lets required attention own the presentation", () => {
    expect(getStatusPresentation({ ...baseStatus, attention: "approval-required" })).toMatchObject({
      label: "Waiting for approval",
      iconRole: "waiting",
      colorRole: "warning",
    });
  });

  it("animates only unseen completion", () => {
    const unseen = getStatusPresentation({
      ...baseStatus,
      activity: "complete",
      attention: "unseen-result",
      outcome: "success",
    });
    const seen = getStatusPresentation({
      ...baseStatus,
      activity: "complete",
      outcome: "success",
    });

    expect(unseen).toMatchObject({
      label: "Completed",
      iconRole: "check",
      colorRole: "success",
      motionClass: "motion-completion",
    });
    expect(seen.motionClass).toBe("motion-resting");
  });

  it("uses a stable stop presentation for interruption", () => {
    expect(getStatusPresentation({ ...baseStatus, activity: "interrupted" })).toMatchObject({
      label: "Interrupted",
      iconRole: "stop",
      motionClass: "motion-resting",
    });
  });

  it("makes failure destructive and recoverable", () => {
    expect(getStatusPresentation({ ...baseStatus, activity: "failed" })).toEqual({
      label: "Failed — retry available",
      iconRole: "error",
      colorRole: "destructive",
      motionClass: "motion-destructive",
      nextAction: "Retry",
    });
  });

  it.each([
    ["idle-resumable", "Ready to resume", "resume"],
    ["settled", "Settled", "settled"],
    ["snoozed", "Snoozed", "snoozed"],
  ] as const)("keeps %s persistence distinct", (persistence, label, iconRole) => {
    expect(
      getStatusPresentation({ ...baseStatus, activity: "complete", persistence }),
    ).toMatchObject({
      label,
      iconRole,
      colorRole: "muted",
    });
  });

  it("maps independent warning and success outcomes semantically", () => {
    const warning = getStatusPresentation({
      ...baseStatus,
      activity: "complete",
      outcome: "warning",
    });
    const success = getStatusPresentation({
      ...baseStatus,
      activity: "complete",
      outcome: "success",
    });

    expect(warning.colorRole).toBe("warning");
    expect(success.colorRole).toBe("success");
  });

  it("gives failure outcome priority over contradictory lower-priority axes", () => {
    expect(
      getStatusPresentation({
        activity: "running",
        attention: "unseen-result",
        outcome: "failure",
        persistence: "settled",
      }),
    ).toMatchObject({ label: "Failed — retry available", iconRole: "error" });
  });

  it("always returns visible text and an icon for every axis combination", () => {
    const activities: StatusActivity[] = [
      "queued",
      "running",
      "waiting",
      "interrupted",
      "complete",
      "failed",
    ];
    const attentions: StatusAttention[] = [
      "none",
      "input-required",
      "approval-required",
      "unseen-result",
    ];
    const outcomes: StatusOutcome[] = ["neutral", "success", "warning", "failure"];
    const persistences: StatusPersistence[] = ["active", "idle-resumable", "snoozed", "settled"];

    for (const activity of activities) {
      for (const attention of attentions) {
        for (const outcome of outcomes) {
          for (const persistence of persistences) {
            const presentation = getStatusPresentation({
              activity,
              attention,
              outcome,
              persistence,
            });
            expect(presentation.label.length).toBeGreaterThan(0);
            expect(presentation.iconRole.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});
