import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { browserSurfaceRectProbeCount, watchBrowserSurfaceRect } from "./browserSurfaceRectWatcher";

interface FrameHost {
  readonly flush: () => void;
  readonly pending: () => number;
  readonly cancelled: () => number;
}

function installFrameHost(): FrameHost {
  let nextId = 1;
  let cancelled = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const stub = {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      cancelled += 1;
      callbacks.delete(id);
    },
  };
  vi.stubGlobal("window", stub);
  return {
    flush: () => {
      const due = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of due) callback(0);
    },
    pending: () => callbacks.size,
    cancelled: () => cancelled,
  };
}

describe("watchBrowserSurfaceRect", () => {
  let host: FrameHost;

  beforeEach(() => {
    host = installFrameHost();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs every probe once per frame and keeps the loop alive", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unwatchFirst = watchBrowserSurfaceRect(first);
    const unwatchSecond = watchBrowserSurfaceRect(second);

    // Both slots share one frame request, not one each.
    expect(host.pending()).toBe(1);
    expect(browserSurfaceRectProbeCount()).toBe(2);

    host.flush();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(host.pending()).toBe(1);

    host.flush();
    expect(first).toHaveBeenCalledTimes(2);

    unwatchFirst();
    host.flush();
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(3);

    unwatchSecond();
  });

  it("cancels the frame when the last slot unmounts", () => {
    const probe = vi.fn();
    const unwatch = watchBrowserSurfaceRect(probe);
    expect(host.pending()).toBe(1);

    unwatch();
    expect(browserSurfaceRectProbeCount()).toBe(0);
    expect(host.cancelled()).toBe(1);
    expect(host.pending()).toBe(0);

    // A repeated unsubscribe must not cancel a later slot's frame.
    unwatch();
    expect(host.cancelled()).toBe(1);
  });

  it("survives a probe unsubscribing itself mid-frame", () => {
    const other = vi.fn();
    let unwatchSelf = () => {};
    const selfRemoving = vi.fn(() => unwatchSelf());
    unwatchSelf = watchBrowserSurfaceRect(selfRemoving);
    const unwatchOther = watchBrowserSurfaceRect(other);

    host.flush();
    expect(selfRemoving).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);

    host.flush();
    expect(selfRemoving).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(2);

    unwatchOther();
  });
});
