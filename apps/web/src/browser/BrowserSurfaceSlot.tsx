"use client";

import { useLayoutEffect, useRef } from "react";

import { watchBrowserSurfaceRect } from "./browserSurfaceRectWatcher";
import { acquireBrowserSurface } from "./browserSurfaceStore";

const CLAIM_RETRY_MS = 250;

export function BrowserSurfaceSlot(props: {
  readonly tabId: string;
  readonly visible: boolean;
  readonly cornerRadius?: number;
  readonly layoutVersion?: string | number;
  readonly className?: string;
  readonly fitSourceContent?: boolean;
}) {
  const {
    tabId,
    visible,
    cornerRadius = 0,
    layoutVersion,
    className,
    fitSourceContent = false,
  } = props;
  const elementRef = useRef<HTMLDivElement | null>(null);
  const presentationRef = useRef({ visible, cornerRadius });
  const updateRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let lease = acquireBrowserSurface(tabId, fitSourceContent);
    let lastClaimAt = 0;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const presentation = presentationRef.current;
      const presented = lease.present(
        {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        },
        presentation.visible && rect.width > 0 && rect.height > 0,
        presentation.cornerRadius,
      );
      // Losing the lease means another slot claimed this tab; take it back so a
      // handoff can't leave the surface hidden. Rate-limited because this now
      // runs per frame: if two slots ever want the same tab at once, they must
      // trade slowly instead of stealing it from each other 60 times a second.
      const now = Date.now();
      if (presentation.visible && !presented && now - lastClaimAt >= CLAIM_RETRY_MS) {
        lastClaimAt = now;
        lease.release();
        lease = acquireBrowserSurface(tabId, fitSourceContent);
        lease.present(
          {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
          },
          rect.width > 0 && rect.height > 0,
          presentation.cornerRadius,
        );
      }
    };
    updateRef.current = update;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    // Position-only shifts (a floating player dragged by its container, a panel
    // opening beside the slot) fire none of the above, so the rect is also
    // re-read per frame; `present` ignores an unchanged rect.
    const unwatch = watchBrowserSurfaceRect(update);
    return () => {
      observer.disconnect();
      unwatch();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      if (updateRef.current === update) updateRef.current = null;
      lease.release();
    };
  }, [fitSourceContent, tabId]);

  useLayoutEffect(() => {
    presentationRef.current = { visible, cornerRadius };
    updateRef.current?.();
  }, [cornerRadius, layoutVersion, visible]);

  return <div ref={elementRef} className={className} data-browser-surface-slot={tabId} />;
}
