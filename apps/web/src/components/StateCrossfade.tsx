import { type ReactNode, useEffect, useRef, useState } from "react";

import { FILES_CROSSFADE_MS, type DiffScopeDirection } from "~/lib/filesDiffsMotion";
import { cn } from "~/lib/utils";

interface RetainedLayer {
  readonly key: string;
  readonly node: ReactNode;
  readonly direction: DiffScopeDirection;
  readonly nonce: number;
}

interface StateCrossfadeProps {
  /**
   * Identity of the content currently rendered. When it changes, the previously
   * rendered subtree is retained and faded out while the new one animates in, so
   * the handoff genuinely overlaps instead of the outgoing content vanishing in
   * the same commit the incoming one mounts.
   */
  readonly contentKey: string;
  /** Directional slide for diff-scope navigation; "none" for a plain crossfade. */
  readonly direction?: DiffScopeDirection;
  readonly className?: string;
  /** Applied to both the entering and the retained (leaving) layer. */
  readonly layerClassName?: string;
  /** Forwarded to the entering (live) layer, e.g. `data-diff-content-state`. */
  readonly "data-diff-content-state"?: string;
  readonly "data-file-preview-state"?: string;
  readonly "data-file-browser-state"?: string;
  readonly children: ReactNode;
}

/**
 * Retained-content crossfade for the files and diffs surfaces (motion plan item
 * 10 / 17). The keyed handoffs here used to be an enter-only animation on a
 * `key` remount, so React deleted the outgoing content in the same commit and
 * nothing overlapped. This keeps the outgoing subtree mounted as its own live
 * fiber for one bounded window: the retained layer holds the exact element that
 * was last rendered (reference-equal, so React bails and its shadow-DOM content
 * survives untouched — a static clone or a document view-transition snapshot
 * cannot capture the shadow trees these surfaces render into), while the fresh
 * layer mounts and animates in over the top.
 *
 * The retained layer is inert and removed by a timer after the crossfade window,
 * so nothing expensive is kept alive longer than the animation. The same timer
 * also settles the live layer: its enter-animation class is dropped once the
 * window elapses, so no finished keyframe animation lingers on an ancestor of
 * the heavy diff/file scroller (a lingering opacity/transform animation keeps the
 * element composited and repaints the whole diff on every scroll frame).
 */
export function StateCrossfade({
  contentKey,
  direction = "none",
  className,
  layerClassName,
  children,
  ...forwardedProps
}: StateCrossfadeProps) {
  const seenKeyRef = useRef(contentKey);
  const liveNodeRef = useRef<ReactNode>(children);
  const nonceRef = useRef(0);
  const [leaving, setLeaving] = useState<RetainedLayer | null>(null);

  // Adjusting state during render (the sanctioned React idiom, used elsewhere in
  // this tree) so the retained layer is captured in the very commit the key
  // changes — before the effect that would run after the outgoing DOM is gone.
  if (seenKeyRef.current !== contentKey) {
    nonceRef.current += 1;
    setLeaving({
      key: seenKeyRef.current,
      node: liveNodeRef.current,
      direction,
      nonce: nonceRef.current,
    });
    seenKeyRef.current = contentKey;
  }
  // Mirror the latest live children so a same-key update (a background refresh
  // that keeps its key) is what gets retained at the next transition.
  liveNodeRef.current = children;

  useEffect(() => {
    if (leaving === null) return;
    const timer = window.setTimeout(() => {
      setLeaving((current) => (current && current.nonce === leaving.nonce ? null : current));
    }, FILES_CROSSFADE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  return (
    <div className={cn("files-crossfade", className)}>
      {leaving ? (
        <div
          // Reuse the outgoing key so React keeps the outgoing fiber in place
          // (no re-instantiation of the tree/diff, no shadow-DOM rebuild) and
          // only swaps its class to start the fade-out.
          key={leaving.key}
          className={cn("files-crossfade-layer files-crossfade-leaving", layerClassName)}
          data-diff-scope-direction={leaving.direction}
          aria-hidden
          inert
        >
          {leaving.node}
        </div>
      ) : null}
      <div
        key={contentKey}
        // Carry the enter animation ONLY while a handoff is in flight (`leaving`
        // is dropped by the timer at the end of the crossfade window, which is
        // the same duration as the animation). Once settled the class is removed
        // so the live layer holds no opacity/translate keyframe animation.
        //
        // This is the performance fix: a CSS animation of composited properties
        // (opacity/translate) is never removed once its class is applied — the
        // Animation object lingers in a finished state and keeps this element on
        // its own compositor layer. Because the heavy Pierre diff scroller
        // (`.diff-render-surface`) is a descendant, that lingering layer forced a
        // full repaint of the visible diff on every scroll frame. Dropping the
        // class returns the settled layer to a plain, un-composited container.
        className={cn(
          "files-crossfade-layer",
          leaving ? "files-crossfade-entering" : null,
          layerClassName,
        )}
        data-diff-scope-direction={direction}
        {...forwardedProps}
      >
        {children}
      </div>
    </div>
  );
}
