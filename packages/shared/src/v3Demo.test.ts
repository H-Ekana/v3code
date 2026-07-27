import { describe, expect, it } from "vite-plus/test";

import {
  isV3DemoResponderSelection,
  isV3DemoResponderTarget,
  V3_DEMO_PROJECT_ID,
  V3_DEMO_RESPONDER_INSTANCE_ID,
  V3_DEMO_THREAD_ID,
  withV3DemoResponderProvider,
} from "./v3Demo.ts";

describe("isV3DemoResponderTarget", () => {
  it("enables the responder only for the seeded playground thread", () => {
    expect(
      isV3DemoResponderTarget({
        enabled: true,
        projectId: V3_DEMO_PROJECT_ID,
        threadId: V3_DEMO_THREAD_ID,
      }),
    ).toBe(true);
  });

  it("does not enable the responder for a new thread in the playground project", () => {
    expect(
      isV3DemoResponderTarget({
        enabled: true,
        projectId: V3_DEMO_PROJECT_ID,
        threadId: "new-thread",
      }),
    ).toBe(false);
  });

  it("does not enable the responder outside the demo launch", () => {
    expect(
      isV3DemoResponderTarget({
        enabled: false,
        projectId: V3_DEMO_PROJECT_ID,
        threadId: V3_DEMO_THREAD_ID,
      }),
    ).toBe(false);
  });
});

describe("withV3DemoResponderProvider", () => {
  it("appends a selectable Task Responder provider when enabled", () => {
    const providers = withV3DemoResponderProvider([], true);

    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({
      instanceId: V3_DEMO_RESPONDER_INSTANCE_ID,
      displayName: "Task Responder",
      enabled: true,
      status: "ready",
      models: [
        {
          slug: "test-responder",
          name: "Task Responder",
          isDefault: true,
        },
      ],
    });
    expect(isV3DemoResponderSelection(providers[0]?.instanceId)).toBe(true);
  });

  it("leaves provider lists unchanged when disabled", () => {
    expect(withV3DemoResponderProvider([], false)).toEqual([]);
  });

  it("does not append a duplicate responder", () => {
    const providers = withV3DemoResponderProvider([], true);

    expect(withV3DemoResponderProvider(providers, true)).toBe(providers);
  });
});
