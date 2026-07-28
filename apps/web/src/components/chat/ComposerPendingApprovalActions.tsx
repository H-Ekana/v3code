import { type ApprovalRequestId, type ProviderApprovalDecision } from "@t3tools/contracts";
import { memo, useCallback, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  isResponding: boolean;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

interface ApprovalActionSpec {
  decision: ProviderApprovalDecision;
  label: string;
  variant: "ghost" | "destructive-outline" | "outline" | "default";
}

export const APPROVAL_ACTIONS: readonly ApprovalActionSpec[] = [
  { decision: "cancel", label: "Cancel turn", variant: "ghost" },
  { decision: "decline", label: "Decline", variant: "destructive-outline" },
  { decision: "acceptForSession", label: "Always allow this session", variant: "outline" },
  { decision: "accept", label: "Approve once", variant: "default" },
];

/**
 * Anything that is not an explicit atom-command success restores the actions.
 * A submission that returns nothing (no active thread) must not strand the
 * panel in a pending state either.
 */
export const isApprovalSubmissionSuccess = (result: unknown): boolean =>
  typeof result === "object" &&
  result !== null &&
  "_tag" in result &&
  (result as { _tag?: unknown })._tag === "Success";

export const formatApprovalPendingStatus = (decision: ProviderApprovalDecision): string => {
  const label =
    APPROVAL_ACTIONS.find((action) => action.decision === decision)?.label ?? "Decision";
  return `${label} — submitting…`;
};

export const APPROVAL_SUBMISSION_ERROR =
  "Could not submit that decision. All approval actions are available again.";

export interface ApprovalSubmissionState {
  readonly owner: ProviderApprovalDecision | null;
  readonly error: string | null;
}

export const APPROVAL_SUBMISSION_IDLE: ApprovalSubmissionState = { owner: null, error: null };

/** Repeated or competing submissions are dropped while one action owns it. */
export const beginApprovalSubmission = (
  state: ApprovalSubmissionState,
  decision: ProviderApprovalDecision,
): ApprovalSubmissionState => (state.owner !== null ? state : { owner: decision, error: null });

/**
 * Ownership is always released, whatever came back. A retained owner would
 * leave every approval action disabled with no way out.
 */
export const settleApprovalSubmission = (
  state: ApprovalSubmissionState,
  result: unknown,
): ApprovalSubmissionState =>
  isApprovalSubmissionSuccess(result)
    ? { owner: null, error: null }
    : { owner: null, error: state.owner === null ? state.error : APPROVAL_SUBMISSION_ERROR };

export interface ApprovalActionPresentation {
  readonly isOwner: boolean;
  readonly isDimmed: boolean;
  readonly disabled: boolean;
  readonly ariaBusy: boolean;
}

export const deriveApprovalActionPresentation = (input: {
  state: ApprovalSubmissionState;
  decision: ProviderApprovalDecision;
  isResponding: boolean;
}): ApprovalActionPresentation => {
  const isOwner = input.state.owner === input.decision;
  const hasOwner = input.state.owner !== null;
  return {
    isOwner,
    isDimmed: hasOwner && !isOwner,
    disabled: input.isResponding || hasOwner,
    ariaBusy: isOwner,
  };
};

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  isResponding,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  const [submission, setSubmission] = useState<ApprovalSubmissionState>(APPROVAL_SUBMISSION_IDLE);
  const submissionRef = useRef(submission);
  submissionRef.current = submission;

  const submit = useCallback(
    async (decision: ProviderApprovalDecision) => {
      const started = beginApprovalSubmission(submissionRef.current, decision);
      if (started.owner !== decision) return;
      submissionRef.current = started;
      setSubmission(started);
      let result: unknown;
      try {
        result = await onRespondToApproval(requestId, decision);
      } catch {
        result = undefined;
      }
      setSubmission((current) => settleApprovalSubmission(current, result));
    },
    [onRespondToApproval, requestId],
  );

  const owningDecision = submission.owner;
  const submitError = submission.error;

  return (
    <>
      {APPROVAL_ACTIONS.map((action) => {
        const presentation = deriveApprovalActionPresentation({
          state: submission,
          decision: action.decision,
          isResponding,
        });
        return (
          <Button
            key={action.decision}
            size="sm"
            variant={action.variant}
            data-approval-decision={action.decision}
            data-approval-owner={presentation.isOwner ? "true" : undefined}
            aria-busy={presentation.ariaBusy}
            disabled={presentation.disabled}
            className={cn(
              "composer-approval-action motion-press",
              presentation.isOwner && "composer-approval-action--owner",
              presentation.isDimmed && "composer-approval-action--dimmed",
            )}
            onClick={() => void submit(action.decision)}
          >
            <span className="composer-approval-action__stack">
              <span className="composer-approval-action__label">{action.label}</span>
              <span className="composer-approval-action__trace" aria-hidden="true" />
            </span>
          </Button>
        );
      })}
      <span className="sr-only" role="status" aria-live="polite">
        {owningDecision ? formatApprovalPendingStatus(owningDecision) : ""}
      </span>
      {submitError ? (
        <span
          role="alert"
          data-approval-error="true"
          className="w-full text-right text-xs text-destructive"
        >
          {submitError}
        </span>
      ) : null}
    </>
  );
});
