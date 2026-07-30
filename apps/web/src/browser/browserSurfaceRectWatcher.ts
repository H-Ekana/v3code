/**
 * The hosted `<webview>` is painted at whatever viewport rect its
 * `BrowserSurfaceSlot` last reported, so a slot that moves without resizing
 * leaves the guest stranded next to its frame. `ResizeObserver` only reports
 * size, and `resize`/`scroll` miss every layout shift caused by a sibling — a
 * panel opening, a thread switch, the composer growing, a CSS transition
 * settling. So slots also re-measure on an animation frame while mounted:
 * `present()` de-dupes identical rects, and `requestAnimationFrame` is paused
 * by the browser while the window is hidden, so an idle preview costs one
 * `getBoundingClientRect()` per frame and nothing else.
 */
type BrowserSurfaceRectProbe = () => void;

const probes = new Set<BrowserSurfaceRectProbe>();
let frameId: number | null = null;

function runFrame() {
  frameId = null;
  for (const probe of [...probes]) {
    probe();
  }
  schedule();
}

function schedule() {
  if (frameId !== null || probes.size === 0) return;
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;
  frameId = window.requestAnimationFrame(runFrame);
}

/** Registers a probe on the shared frame loop. Returns its unsubscribe. */
export function watchBrowserSurfaceRect(probe: BrowserSurfaceRectProbe): () => void {
  probes.add(probe);
  schedule();
  return () => {
    if (!probes.delete(probe)) return;
    if (probes.size > 0 || frameId === null) return;
    window.cancelAnimationFrame(frameId);
    frameId = null;
  };
}

/** Test seam: the number of live probes on the shared loop. */
export function browserSurfaceRectProbeCount(): number {
  return probes.size;
}
