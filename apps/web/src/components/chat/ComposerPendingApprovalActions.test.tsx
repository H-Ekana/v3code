import { ApprovalRequestId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  APPROVAL_ACTIONS,
  APPROVAL_SUBMISSION_ERROR,
  APPROVAL_SUBMISSION_IDLE,
  ComposerPendingApprovalActions,
  beginApprovalSubmission,
  deriveApprovalActionPresentation,
  formatApprovalPendingStatus,
  isApprovalSubmissionSuccess,
  settleApprovalSubmission,
} from "./ComposerPendingApprovalActions";

describe("approval submission ownership", () => {
  it("makes the chosen action the progress owner", () => {
    const state = beginApprovalSubmission(APPROVAL_SUBMISSION_IDLE, "accept");
    expect(state.owner).toBe("accept");

    const owner = deriveApprovalActionPresentation({
      state,
      decision: "accept",
      isResponding: false,
    });
    expect(owner).toEqual({ isOwner: true, isDimmed: false, disabled: true, ariaBusy: true });
  });

  it("dims and disables the alternatives while one action owns the request", () => {
    const state = beginApprovalSubmission(APPROVAL_SUBMISSION_IDLE, "accept");
    for (const action of APPROVAL_ACTIONS) {
      if (action.decision === "accept") continue;
      const presentation = deriveApprovalActionPresentation({
        state,
        decision: action.decision,
        isResponding: false,
      });
      expect(presentation.isDimmed).toBe(true);
      expect(presentation.disabled).toBe(true);
      expect(presentation.ariaBusy).toBe(false);
    }
  });

  it("drops a competing or repeated submission while one is in flight", () => {
    const state = beginApprovalSubmission(APPROVAL_SUBMISSION_IDLE, "accept");
    expect(beginApprovalSubmission(state, "decline").owner).toBe("accept");
    expect(beginApprovalSubmission(state, "accept")).toBe(state);
  });

  it("restores every action with an error when submission fails", () => {
    const pending = beginApprovalSubmission(APPROVAL_SUBMISSION_IDLE, "decline");
    const settled = settleApprovalSubmission(pending, { _tag: "Failure" });
    expect(settled.owner).toBeNull();
    expect(settled.error).toBe(APPROVAL_SUBMISSION_ERROR);

    for (const action of APPROVAL_ACTIONS) {
      const presentation = deriveApprovalActionPresentation({
        state: settled,
        decision: action.decision,
        isResponding: false,
      });
      expect(presentation.disabled).toBe(false);
      expect(presentation.isDimmed).toBe(false);
    }
  });

  it("treats a missing result as a failure rather than holding ownership", () => {
    const pending = beginApprovalSubmission(APPROVAL_SUBMISSION_IDLE, "cancel");
    for (const result of [undefined, null, {}, { _tag: "Failure" }]) {
      const settled = settleApprovalSubmission(pending, result);
      expect(settled.owner).toBeNull();
      expect(settled.error).toBe(APPROVAL_SUBMISSION_ERROR);
    }
    expect(isApprovalSubmissionSuccess({ _tag: "Success" })).toBe(true);
  });

  it("clears ownership and error on success", () => {
    const pending = beginApprovalSubmission(APPROVAL_SUBMISSION_IDLE, "acceptForSession");
    expect(settleApprovalSubmission(pending, { _tag: "Success" })).toEqual({
      owner: null,
      error: null,
    });
  });

  it("announces the submitted choice", () => {
    expect(formatApprovalPendingStatus("acceptForSession")).toBe(
      "Always allow this session — submitting…",
    );
  });
});

describe("ComposerPendingApprovalActions markup", () => {
  it("keeps the outer geometry stable by stacking the trace over the label", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-1")}
        isResponding={false}
        onRespondToApproval={vi.fn(async () => ({ _tag: "Success" }))}
      />,
    );

    for (const action of APPROVAL_ACTIONS) {
      expect(markup).toContain(`data-approval-decision="${action.decision}"`);
      expect(markup).toContain(action.label);
    }
    expect(markup).toContain("composer-approval-action__stack");
    expect(markup).toContain("composer-approval-action__label");
    expect(markup).toContain("composer-approval-action__trace");
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('data-approval-error="true"');
  });

  it("disables every action while the parent reports an in-flight response", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-1")}
        isResponding
        onRespondToApproval={vi.fn(async () => ({ _tag: "Success" }))}
      />,
    );
    expect(markup.match(/disabled=""/g)?.length).toBe(APPROVAL_ACTIONS.length);
  });
});
