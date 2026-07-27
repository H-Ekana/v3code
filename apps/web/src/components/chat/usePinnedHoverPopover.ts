import type { PopoverRootChangeEventDetails } from "@base-ui/react/popover";
import { useCallback, useRef, useState } from "react";

export interface PinnedHoverPopoverState {
  readonly open: boolean;
  readonly pinned: boolean;
}

export interface PinnedHoverPopoverChange {
  readonly open: boolean;
  readonly reason: PopoverRootChangeEventDetails["reason"];
}

interface PinnedHoverPopoverTransition {
  readonly state: PinnedHoverPopoverState;
  readonly cancelBaseTransition: boolean;
}

const CLOSED_STATE: PinnedHoverPopoverState = {
  open: false,
  pinned: false,
};

export function getPinnedHoverPopoverTransition(
  state: PinnedHoverPopoverState,
  change: PinnedHoverPopoverChange,
): PinnedHoverPopoverTransition {
  if (change.reason === "trigger-press") {
    const nextState =
      state.open && state.pinned
        ? CLOSED_STATE
        : {
            open: true,
            pinned: true,
          };

    return {
      state: nextState,
      cancelBaseTransition: change.open !== nextState.open,
    };
  }

  if (change.reason === "trigger-hover") {
    return state.pinned
      ? {
          state,
          cancelBaseTransition: true,
        }
      : {
          state: {
            open: change.open,
            pinned: false,
          },
          cancelBaseTransition: false,
        };
  }

  return {
    state: change.open
      ? {
          open: true,
          pinned: false,
        }
      : CLOSED_STATE,
    cancelBaseTransition: false,
  };
}

export function usePinnedHoverPopover() {
  const [state, setState] = useState<PinnedHoverPopoverState>(CLOSED_STATE);
  const stateRef = useRef(state);

  const onOpenChange = useCallback((open: boolean, eventDetails: PopoverRootChangeEventDetails) => {
    const transition = getPinnedHoverPopoverTransition(stateRef.current, {
      open,
      reason: eventDetails.reason,
    });

    if (transition.cancelBaseTransition) {
      eventDetails.cancel();
    }

    stateRef.current = transition.state;
    setState(transition.state);
  }, []);

  return {
    open: state.open,
    onOpenChange,
  };
}
