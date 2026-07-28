import { memo, useCallback, useEffect, useState, type PointerEventHandler } from "react";
import { ChevronDownIcon, ChevronLeftIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { StageBackdropButtonArt, useSidebarStageBackdropVariant } from "../SidebarStageBackdrop";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";

interface PendingActionState {
  questionIndex: number;
  isLastQuestion: boolean;
  canAdvance: boolean;
  isResponding: boolean;
  isComplete: boolean;
}

/**
 * Stop/interrupt state contract.
 *
 * `pending` is the only state that disables the control, and every exit from
 * `pending` is driven by an event that this module also owns: the request
 * failing, the turn settling, or the unconfirmed watchdog firing. There is no
 * path that leaves the user without a working stop button.
 */
export type ComposerInterruptState = "idle" | "pending" | "failed" | "unconfirmed";

export type ComposerInterruptEvent =
  | "press"
  | "request-failed"
  | "request-accepted"
  | "turn-settled"
  | "unconfirmed"
  | "reset";

/**
 * The interrupted-turn wedge (see KNOWN-ISSUES.md) means an accepted interrupt
 * can never settle the session row. The watchdog restores the stop action so a
 * server-side wedge cannot present as a dead button.
 */
export const COMPOSER_INTERRUPT_UNCONFIRMED_TIMEOUT_MS = 6000;

export const nextComposerInterruptState = (
  current: ComposerInterruptState,
  event: ComposerInterruptEvent,
): ComposerInterruptState => {
  switch (event) {
    case "press":
      return "pending";
    case "request-accepted":
      return current === "pending" ? "pending" : current;
    case "request-failed":
      return "failed";
    case "unconfirmed":
      return current === "pending" ? "unconfirmed" : current;
    case "turn-settled":
    case "reset":
      return "idle";
  }
};

/** Repeated stop requests are dropped while one is in flight. */
export const canRequestComposerInterrupt = (current: ComposerInterruptState): boolean =>
  current !== "pending";

export interface StopControlPresentation {
  readonly dataState: ComposerInterruptState;
  readonly disabled: boolean;
  readonly ariaBusy: boolean;
  readonly label: string;
  readonly showTrace: boolean;
  /** Politely announced; never the only carrier of the state. */
  readonly status: string;
}

export const deriveStopControlPresentation = (
  state: ComposerInterruptState,
): StopControlPresentation => {
  switch (state) {
    case "pending":
      return {
        dataState: "pending",
        disabled: true,
        ariaBusy: true,
        label: "Stopping generation",
        showTrace: true,
        status: "Stopping…",
      };
    case "failed":
      return {
        dataState: "failed",
        disabled: false,
        ariaBusy: false,
        label: "Stop generation — previous stop failed, try again",
        showTrace: false,
        status: "Stop request failed. The stop button is available again.",
      };
    case "unconfirmed":
      return {
        dataState: "unconfirmed",
        disabled: false,
        ariaBusy: false,
        label: "Stop generation — stop not confirmed, try again",
        showTrace: false,
        status: "Stop was not confirmed. The stop button is available again.",
      };
    case "idle":
      return {
        dataState: "idle",
        disabled: false,
        ariaBusy: false,
        label: "Stop generation",
        showTrace: false,
        status: "",
      };
  }
};

interface ComposerPrimaryActionsProps {
  compact: boolean;
  pendingAction: PendingActionState | null;
  isRunning: boolean;
  interruptState?: ComposerInterruptState;
  showPlanFollowUpPrompt: boolean;
  promptHasText: boolean;
  isSendBusy: boolean;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  isPreparingWorktree: boolean;
  hasSendableContent: boolean;
  isSendCelebrating?: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
  onSendCelebrationEnd?: () => void;
}

export const COMPOSER_SEND_CELEBRATION_DURATION_MS = 480;

export const formatPendingPrimaryActionLabel = (input: {
  compact: boolean;
  isLastQuestion: boolean;
  isResponding: boolean;
  questionIndex: number;
}) => {
  if (input.isResponding) {
    return "Submitting...";
  }
  if (input.compact) {
    return input.isLastQuestion ? "Submit" : "Next";
  }
  if (!input.isLastQuestion) {
    return "Next question";
  }
  return input.questionIndex > 0 ? "Submit answers" : "Submit answer";
};

export const shouldShowComposerSendSpinner = (input: {
  isConnecting: boolean;
  isSendBusy: boolean;
  isSendArrowAnimating: boolean;
}) => input.isConnecting || (input.isSendBusy && !input.isSendArrowAnimating);

const preventPointerFocus: PointerEventHandler<HTMLElement> = (event) => {
  event.preventDefault();
};

export const ComposerPrimaryActions = memo(function ComposerPrimaryActions({
  compact,
  pendingAction,
  isRunning,
  interruptState = "idle",
  showPlanFollowUpPrompt,
  promptHasText,
  isSendBusy,
  isConnecting,
  isEnvironmentUnavailable,
  isPreparingWorktree,
  hasSendableContent,
  isSendCelebrating = false,
  preserveComposerFocusOnPointerDown = false,
  onPreviousPendingQuestion,
  onInterrupt,
  onImplementPlanInNewThread,
  onSendCelebrationEnd,
}: ComposerPrimaryActionsProps) {
  const pointerFocusProps = preserveComposerFocusOnPointerDown
    ? { onPointerDown: preventPointerFocus }
    : undefined;
  const stageBackdropVariant = useSidebarStageBackdropVariant();

  // Press acknowledgment is owned by React state, not `:active`. Binding to
  // `:active` cancelled the ring at pointerup, so it could never coexist with
  // the pending state. Latching on pointerdown makes the ack fire immediately
  // and persist through the whole `pending` phase; it clears only when the
  // stop machine settles back to `idle`.
  const [stopPressed, setStopPressed] = useState(false);
  useEffect(() => {
    if (interruptState === "idle") {
      setStopPressed(false);
    }
  }, [interruptState]);
  const handleStopPointerDown = useCallback<PointerEventHandler<HTMLButtonElement>>(
    (event) => {
      if (preserveComposerFocusOnPointerDown) {
        event.preventDefault();
      }
      setStopPressed(true);
    },
    [preserveComposerFocusOnPointerDown],
  );

  if (pendingAction) {
    return (
      <div className={cn("flex items-center justify-end", compact ? "gap-1.5" : "gap-2")}>
        {pendingAction.questionIndex > 0 ? (
          compact ? (
            <Button
              size="icon-sm"
              variant="outline"
              className="rounded-full"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
              aria-label="Previous question"
            >
              <ChevronLeftIcon className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
            >
              Previous
            </Button>
          )
        ) : null}
        <Button
          type="submit"
          size="sm"
          data-composer-pending-submit="true"
          aria-busy={pendingAction.isResponding}
          className={cn("rounded-full", compact ? "px-3" : "px-4")}
          {...pointerFocusProps}
          disabled={
            isEnvironmentUnavailable ||
            pendingAction.isResponding ||
            (pendingAction.isLastQuestion ? !pendingAction.isComplete : !pendingAction.canAdvance)
          }
        >
          {formatPendingPrimaryActionLabel({
            compact,
            isLastQuestion: pendingAction.isLastQuestion,
            isResponding: pendingAction.isResponding,
            questionIndex: pendingAction.questionIndex,
          })}
        </Button>
        <span className="sr-only" role="status" aria-live="polite">
          {pendingAction.isResponding ? "Submitting your answer…" : ""}
        </span>
      </div>
    );
  }

  if (isRunning) {
    const stop = deriveStopControlPresentation(interruptState);
    return (
      <div className="relative flex items-center">
        <button
          type="button"
          data-composer-stop-button="true"
          data-stop-state={stop.dataState}
          data-stop-pressed={stopPressed ? "true" : undefined}
          className="composer-stop-button relative flex size-8 items-center justify-center rounded-full bg-destructive/90 text-white shadow-xs shadow-destructive/24 inset-shadow-[0_1px_--theme(--color-white/16%)] transition-all duration-150 enabled:cursor-pointer enabled:hover:scale-105 enabled:hover:bg-destructive active:inset-shadow-[0_1px_--theme(--color-black/8%)] active:shadow-none disabled:hover:scale-100 sm:h-8 sm:w-8"
          onPointerDown={handleStopPointerDown}
          onClick={onInterrupt}
          disabled={stop.disabled}
          aria-busy={stop.ariaBusy}
          aria-label={stop.label}
        >
          <span className="composer-stop-button__press-ring" aria-hidden="true" />
          <svg
            className="composer-stop-button__glyph"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="2" y="2" width="8" height="8" rx="1.5" />
          </svg>
          {stop.showTrace ? (
            <span className="composer-stop-button__trace" aria-hidden="true" />
          ) : null}
        </button>
        <span className="sr-only" role="status" aria-live="polite" data-composer-stop-status="true">
          {stop.status}
        </span>
      </div>
    );
  }

  if (showPlanFollowUpPrompt) {
    if (promptHasText) {
      return (
        <Button
          type="submit"
          size="sm"
          className={cn("rounded-full", compact ? "h-9 px-3 sm:h-8" : "h-9 px-4 sm:h-8")}
          {...pointerFocusProps}
          disabled={isSendBusy || isConnecting || isEnvironmentUnavailable}
        >
          {isConnecting || isSendBusy ? "Sending..." : "Refine"}
        </Button>
      );
    }

    return (
      <div data-chat-composer-implement-actions="true" className="flex items-center justify-end">
        <Button
          type="submit"
          size="sm"
          className="h-9 rounded-l-full rounded-r-none px-4 sm:h-8"
          {...pointerFocusProps}
          disabled={isSendBusy || isConnecting || isEnvironmentUnavailable}
        >
          {isConnecting || isSendBusy ? "Sending..." : "Implement"}
        </Button>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="sm"
                variant="default"
                className="h-9 rounded-l-none rounded-r-full border-l-white/12 px-2 sm:h-8"
                aria-label="Implementation actions"
                {...pointerFocusProps}
                disabled={isSendBusy || isConnecting || isEnvironmentUnavailable}
              />
            }
          >
            <ChevronDownIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end" side="top">
            <MenuItem
              disabled={isSendBusy || isConnecting || isEnvironmentUnavailable}
              onClick={() => void onImplementPlanInNewThread()}
            >
              Implement in a new thread
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    );
  }

  return (
    <button
      type="submit"
      className={cn(
        "relative isolate flex h-9 w-9 items-center justify-center overflow-visible rounded-full text-primary-foreground shadow-xs transition-all duration-200 enabled:cursor-pointer enabled:inset-shadow-[0_1px_--theme(--color-white/16%)] hover:scale-105 active:inset-shadow-[0_1px_--theme(--color-black/8%)] active:shadow-none disabled:pointer-events-none disabled:opacity-30 disabled:shadow-none disabled:hover:scale-100 sm:h-8 sm:w-8",
        isSendCelebrating && "composer-send-button--sending",
        stageBackdropVariant === "nightly"
          ? "composer-send-button--nightly bg-[#2a245d] text-white enabled:shadow-[0_3px_8px_rgba(93,58,151,0.3)]"
          : stageBackdropVariant === "dev"
            ? "bg-transparent enabled:shadow-black/24 enabled:hover:brightness-110"
            : "bg-primary/90 enabled:shadow-primary/24 hover:bg-primary",
      )}
      {...pointerFocusProps}
      disabled={isSendBusy || isConnecting || isEnvironmentUnavailable || !hasSendableContent}
      aria-label={
        isEnvironmentUnavailable
          ? "Environment disconnected"
          : isConnecting
            ? "Connecting"
            : isPreparingWorktree
              ? "Preparing worktree"
              : isSendBusy
                ? "Sending"
                : "Send message"
      }
    >
      {stageBackdropVariant ? (
        <span
          className={cn(
            "absolute inset-0 -z-10 overflow-hidden rounded-[inherit]",
            stageBackdropVariant === "nightly" && "opacity-100",
          )}
          aria-hidden="true"
        >
          <StageBackdropButtonArt variant={stageBackdropVariant} />
        </span>
      ) : null}
      {shouldShowComposerSendSpinner({
        isConnecting,
        isSendBusy,
        isSendArrowAnimating: isSendCelebrating,
      }) ? (
        <Spinner className="size-3.5" aria-hidden="true" />
      ) : (
        <span
          className={cn("composer-send-arrow", isSendCelebrating && "composer-send-arrow--sending")}
          onAnimationEnd={(event) => {
            if (event.animationName === "composer-send-arrow-launch") {
              onSendCelebrationEnd?.();
            }
          }}
        >
          <svg
            className="composer-send-arrow__glyph"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
      <span className="composer-send-launch-burst" aria-hidden="true" />
    </button>
  );
});
