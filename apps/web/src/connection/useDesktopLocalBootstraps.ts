import type { DesktopEnvironmentBootstrap } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { readDesktopSecondaryBootstraps } from "./desktopLocal";

const DESKTOP_LOCAL_BOOTSTRAP_POLL_MS = 5_000;

// One shared poller for every consumer (sidebar, command palette, ...): the
// bridge read is a blocking sendSync IPC round-trip, so per-consumer
// intervals multiply a cost the renderer only needs to pay once.
const listeners = new Set<() => void>();
let snapshot: ReadonlyArray<DesktopEnvironmentBootstrap> | null = null;
let pollHandle: ReturnType<typeof setInterval> | null = null;

const poll = () => {
  const next = readDesktopSecondaryBootstraps();
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  // Refresh on every mount so a late-arriving consumer never renders a
  // snapshot older than one interval (matches the previous per-hook read).
  poll();
  if (pollHandle === null) {
    pollHandle = setInterval(poll, DESKTOP_LOCAL_BOOTSTRAP_POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && pollHandle !== null) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  };
};

const getSnapshot = (): ReadonlyArray<DesktopEnvironmentBootstrap> => {
  if (snapshot === null) {
    snapshot = readDesktopSecondaryBootstraps();
  }
  return snapshot;
};

/**
 * Reactively track the desktop's secondary local backends (e.g. a parallel WSL
 * backend). The bridge exposes no change event, so a single shared interval
 * re-reads the topology; failed reads retain the latest successful snapshot,
 * while a successful empty read clears it. Snapshot identity is stable across
 * unchanged reads, so consumers only re-render when the topology changes. Use
 * this instead of polling the bridge ad hoc so every renderer consumer reads
 * the same topology.
 */
export function useDesktopLocalBootstraps(): ReadonlyArray<DesktopEnvironmentBootstrap> {
  return useSyncExternalStore(subscribe, getSnapshot);
}
