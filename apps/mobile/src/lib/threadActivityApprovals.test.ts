import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { EventId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { derivePendingApprovals, sortThreadActivities } from "./threadActivity";

function approvalRequested(overrides: {
  readonly id: string;
  readonly createdAt: string;
  readonly payload: Record<string, unknown>;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(overrides.id),
    createdAt: overrides.createdAt,
    kind: "approval.requested",
    summary: "Approval requested",
    tone: "approval",
    payload: overrides.payload,
    turnId: null,
  };
}

describe("derivePendingApprovals", () => {
  it("still surfaces an approval whose requestType is unrecognized", () => {
    // Regression: OpenCode's `permission` vocabulary is open-ended, so kinds
    // like `grep`/`glob` canonicalize to requestType "unknown". Dropping them
    // left the server counting an approval no card could ever resolve, which
    // pinned the thread as un-settleable forever.
    const activities = sortThreadActivities([
      approvalRequested({
        id: "approval-unknown-kind",
        createdAt: "2026-02-23T00:00:01.000Z",
        payload: {
          requestId: "req-unknown-kind",
          requestType: "unknown",
          detail: "apps/desktop/**/*.{ts,tsx}",
        },
      }),
    ]);

    expect(derivePendingApprovals(activities)).toEqual([
      {
        requestId: "req-unknown-kind",
        requestKind: "other",
        createdAt: "2026-02-23T00:00:01.000Z",
        detail: "apps/desktop/**/*.{ts,tsx}",
      },
    ]);
  });

  it("keeps mapping recognized kinds", () => {
    const activities = sortThreadActivities([
      approvalRequested({
        id: "approval-command",
        createdAt: "2026-02-23T00:00:01.000Z",
        payload: { requestId: "req-command", requestKind: "command", detail: "bun run lint" },
      }),
    ]);

    expect(derivePendingApprovals(activities)).toEqual([
      {
        requestId: "req-command",
        requestKind: "command",
        createdAt: "2026-02-23T00:00:01.000Z",
        detail: "bun run lint",
      },
    ]);
  });
});
