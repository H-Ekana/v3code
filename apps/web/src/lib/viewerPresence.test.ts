import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { isViewerPresent, subscribeViewerPresence } from "./viewerPresence";

function installDocument(input: {
  visibilityState: DocumentVisibilityState;
  hasFocus?: (() => boolean) | undefined;
}) {
  const documentListeners = new Map<string, Set<() => void>>();
  const windowListeners = new Map<string, Set<() => void>>();
  const add = (registry: Map<string, Set<() => void>>) => (type: string, listener: () => void) => {
    const existing = registry.get(type) ?? new Set<() => void>();
    existing.add(listener);
    registry.set(type, existing);
  };
  const remove =
    (registry: Map<string, Set<() => void>>) => (type: string, listener: () => void) => {
      registry.get(type)?.delete(listener);
    };
  vi.stubGlobal("document", {
    visibilityState: input.visibilityState,
    ...(input.hasFocus ? { hasFocus: input.hasFocus } : {}),
    addEventListener: add(documentListeners),
    removeEventListener: remove(documentListeners),
  });
  vi.stubGlobal("window", {
    addEventListener: add(windowListeners),
    removeEventListener: remove(windowListeners),
  });
  return {
    emit: (type: string) => {
      for (const listener of [
        ...(documentListeners.get(type) ?? []),
        ...(windowListeners.get(type) ?? []),
      ]) {
        listener();
      }
    },
    listenerCount: () =>
      [...documentListeners.values(), ...windowListeners.values()].reduce(
        (total, listeners) => total + listeners.size,
        0,
      ),
  };
}

describe("isViewerPresent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires the window to be both visible and focused", () => {
    installDocument({ visibilityState: "visible", hasFocus: () => true });
    expect(isViewerPresent()).toBe(true);

    installDocument({ visibilityState: "visible", hasFocus: () => false });
    expect(isViewerPresent()).toBe(false);

    installDocument({ visibilityState: "hidden", hasFocus: () => true });
    expect(isViewerPresent()).toBe(false);
  });

  it("treats a host without focus reporting as present when visible", () => {
    installDocument({ visibilityState: "visible" });
    expect(isViewerPresent()).toBe(true);
  });
});

describe("subscribeViewerPresence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("notifies on visibility and focus transitions until unsubscribed", () => {
    const host = installDocument({ visibilityState: "visible", hasFocus: () => true });
    const listener = vi.fn();
    const unsubscribe = subscribeViewerPresence(listener);
    expect(host.listenerCount()).toBe(3);

    host.emit("visibilitychange");
    host.emit("focus");
    host.emit("blur");
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    expect(host.listenerCount()).toBe(0);
    host.emit("focus");
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
