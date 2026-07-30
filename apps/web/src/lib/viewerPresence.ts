/**
 * "Is the person actually looking at this window right now?" — visible AND
 * focused, the same pair the toast timer uses to decide whether a toast is
 * being read. Visibility alone is too generous on desktop: a window sitting
 * behind the editor still reports `visible`, and work that finishes back there
 * genuinely was missed.
 */
export function isViewerPresent(): boolean {
  if (typeof document === "undefined") return true;
  if (document.visibilityState !== "visible") return false;
  return typeof document.hasFocus === "function" ? document.hasFocus() : true;
}

/** Fires on every transition into or out of presence. Returns its unsubscribe. */
export function subscribeViewerPresence(listener: () => void): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") return () => {};
  document.addEventListener("visibilitychange", listener);
  window.addEventListener("focus", listener);
  window.addEventListener("blur", listener);
  return () => {
    document.removeEventListener("visibilitychange", listener);
    window.removeEventListener("focus", listener);
    window.removeEventListener("blur", listener);
  };
}
