import type { ComponentProps, PointerEvent as ReactPointerEvent } from "react";
import { ChevronDownIcon, type LucideIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { SelectTrigger } from "../ui/select";

export const COMPOSER_CONTROL_MIN_PRESS_MS = 70;

const composerControlClassName =
  "h-7 min-h-7 gap-1.5 px-2.5 text-muted-foreground/70 hover:text-foreground/80 [&_svg[data-composer-control-icon]]:mx-0 [&_svg[data-composer-control-chevron]]:-mx-0.5";

type ActiveComposerControlPress = {
  cancel: () => void;
};

const activeComposerControlPresses = new WeakMap<HTMLElement, ActiveComposerControlPress>();

/**
 * Base UI menus and selects open on mousedown, while buttons and popovers open
 * on click. Latch the visual press one event earlier so every composer control
 * completes the same inward response before popup focus and portal work begins.
 */
function beginComposerControlPress(event: ReactPointerEvent<HTMLElement>): void {
  const element = event.currentTarget;
  if (event.button !== 0 || element.matches(":disabled, [data-disabled]")) return;

  activeComposerControlPresses.get(element)?.cancel();
  element.setAttribute("data-composer-pressing", "true");

  const pointerId = event.pointerId;
  const startedAt = Date.now();
  let released = false;
  let releaseTimer: number | null = null;

  const removePress = () => {
    if (activeComposerControlPresses.get(element) !== press) return;
    element.removeAttribute("data-composer-pressing");
    activeComposerControlPresses.delete(element);
  };
  const removeListeners = () => {
    window.removeEventListener("pointerup", handlePointerEnd, true);
    window.removeEventListener("pointercancel", handlePointerEnd, true);
    window.removeEventListener("blur", handleWindowBlur, true);
  };
  const release = () => {
    if (released) return;
    released = true;
    removeListeners();
    const remaining = Math.max(0, COMPOSER_CONTROL_MIN_PRESS_MS - (Date.now() - startedAt));
    if (remaining === 0) {
      removePress();
    } else {
      releaseTimer = window.setTimeout(removePress, remaining);
    }
  };
  const handlePointerEnd = (pointerEvent: PointerEvent) => {
    if (pointerEvent.pointerId === pointerId) release();
  };
  const handleWindowBlur = () => release();
  const press: ActiveComposerControlPress = {
    cancel: () => {
      released = true;
      removeListeners();
      if (releaseTimer !== null) window.clearTimeout(releaseTimer);
      removePress();
    },
  };

  activeComposerControlPresses.set(element, press);
  window.addEventListener("pointerup", handlePointerEnd, true);
  window.addEventListener("pointercancel", handlePointerEnd, true);
  window.addEventListener("blur", handleWindowBlur, true);
}

export function ComposerControl({
  className,
  size = "sm",
  variant = "ghost",
  onPointerDown,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn(composerControlClassName, className)}
      data-composer-control="true"
      size={size}
      variant={variant}
      onPointerDown={(event) => {
        beginComposerControlPress(event);
        onPointerDown?.(event);
      }}
      {...props}
    />
  );
}

export function ComposerControlIcon({
  icon: Icon,
  className,
  opticalSize = "default",
}: {
  icon: LucideIcon;
  className?: string | undefined;
  opticalSize?: "default" | "large";
}) {
  return (
    <Icon
      aria-hidden="true"
      className={cn("shrink-0", opticalSize === "large" ? "size-4.5" : "size-4", className)}
      data-composer-control-icon
    />
  );
}

export function ComposerControlChevron() {
  return (
    <ChevronDownIcon
      aria-hidden="true"
      className="-mx-0.5 size-3.5 shrink-0 text-muted-foreground opacity-70"
      data-composer-control-chevron
      strokeWidth={2.25}
    />
  );
}

export function ComposerSelectControl({
  className,
  size = "sm",
  variant = "ghost",
  onPointerDown,
  ...props
}: ComponentProps<typeof SelectTrigger>) {
  return (
    <SelectTrigger
      className={cn(composerControlClassName, className)}
      data-composer-control="true"
      icon={<ComposerControlChevron />}
      size={size}
      variant={variant}
      onPointerDown={(event) => {
        beginComposerControlPress(event);
        onPointerDown?.(event);
      }}
      {...props}
    />
  );
}
