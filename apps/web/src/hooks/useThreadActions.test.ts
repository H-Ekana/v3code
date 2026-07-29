import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { toastManager } from "../components/ui/toast";
import { dispatchDurableThreadDelete, ThreadArchiveBlockedError } from "./useThreadActions";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ThreadArchiveBlockedError", () => {
  it("keeps the blocked thread context with the fixed message", () => {
    const error = new ThreadArchiveBlockedError({
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-1"),
    });

    expect(error).toMatchObject({
      environmentId: "environment-1",
      threadId: "thread-1",
    });
    expect(error.message).toBe("Cannot archive a running thread.");
  });
});

describe("dispatchDurableThreadDelete", () => {
  const target = {
    environmentId: EnvironmentId.make("environment-1"),
    threadId: ThreadId.make("542eab66-3463-4987-9bbb-e61f7c0e4b2a"),
  };

  it("dispatches the durable delete without waiting for terminal cleanup", async () => {
    const neverSettlingTerminalClose = vi.fn(() => new Promise<never>(() => {}));
    const dispatch = vi.fn(async () => AsyncResult.success(undefined));
    vi.spyOn(console, "info").mockImplementation(() => {});

    // Reproduce the old cleanup hanging after it has started. It must no longer gate deletion.
    void neverSettlingTerminalClose();
    const deleteResult = dispatchDurableThreadDelete({
      target,
      providerName: "Codex",
      dispatch,
    });

    expect(neverSettlingTerminalClose).toHaveBeenCalledOnce();
    await expect(deleteResult).resolves.toMatchObject({ _tag: "Success" });
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("surfaces a failed delete with provider and thread context for retry", async () => {
    const failure = AsyncResult.failure(Cause.fail(new Error("backend unavailable")));
    const dispatch = vi.fn(async () => failure);
    const toast = vi.spyOn(toastManager, "add");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(
      dispatchDurableThreadDelete({
        target,
        providerName: "Codex",
        dispatch,
      }),
    ).resolves.toBe(failure);

    expect(log).toHaveBeenCalledWith(
      "[thread-delete] durable delete failed for Codex thread …7c0e4b2a",
      expect.objectContaining({
        providerName: "Codex",
        threadId: target.threadId,
        threadIdSuffix: "7c0e4b2a",
      }),
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        title: "Could not delete thread",
        description:
          "Codex thread …7c0e4b2a was not deleted. Try Delete again. backend unavailable",
        data: expect.objectContaining({ threadRef: target }),
      }),
    );
  });
});
