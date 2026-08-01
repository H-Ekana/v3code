import type {
  ResizableWidthHandlers,
  ResizableWidthSeparatorProps,
} from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

interface Props {
  handlers: ResizableWidthHandlers;
  separatorProps: ResizableWidthSeparatorProps;
  isResizing: boolean;
  ariaLabel?: string;
  edge?: "left" | "right";
  className?: string;
}

/**
 * Hit target for resizing a right-anchored panel via its left edge.
 *
 * - Sits on top of the panel's border with a 4px overlap on each side so the
 *   user can grab a few pixels off the edge without aiming.
 * - Visual indicator is a 1px line that lights up on hover/active to mirror
 *   VS Code / Cursor.
 */
export function RightPanelResizeHandle({
  handlers,
  separatorProps,
  isResizing,
  ariaLabel = "Resize preview panel",
  edge = "left",
  className,
}: Props) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        "a11y-resize-handle group absolute inset-y-0 z-20 w-2 cursor-col-resize select-none outline-none",
        edge === "left" ? "-left-1" : "-right-1",
        className,
      )}
      data-resizing={isResizing ? "true" : "false"}
      {...separatorProps}
      {...handlers}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent",
          // No `var()` fallback: motion.css is imported first, so the token
          // always exists and a fallback would only ever be a stale copy.
          "transition-colors [transition-duration:var(--motion-hover)]",
          "group-hover:bg-primary/65 group-focus-visible:bg-primary/65 group-data-[resizing=true]:bg-primary",
          "motion-reduce:transition-none",
        )}
      />
    </div>
  );
}
