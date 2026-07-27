import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";

export const V3_DEMO_PROJECT_ID = "v3-agent-playground";
export const V3_DEMO_THREAD_ID = "v3-agent-sidebar-demo";

export const V3_DEMO_RESPONDER_ENV = "T3CODE_V3_DEMO_RESPONDER";
export const V3_DEMO_RESPONDER_INSTANCE_ID = "v3-demo-responder";
export const V3_DEMO_RESPONDER_MODEL = "test-responder";
export const V3_DEMO_RESPONSE_TEXT = "This is just a test, this is just a test.";
export const V3_DEMO_RESPONDER_DISPLAY_NAME = "Task Responder";

export function isV3DemoResponderSelection(instanceId: string | null | undefined): boolean {
  return instanceId === V3_DEMO_RESPONDER_INSTANCE_ID;
}

export function withV3DemoResponderProvider(
  providers: ReadonlyArray<ServerProvider>,
  enabled: boolean,
): ReadonlyArray<ServerProvider> {
  if (!enabled || providers.some((provider) => isV3DemoResponderSelection(provider.instanceId))) {
    return providers;
  }

  const driver = ProviderDriverKind.make(V3_DEMO_RESPONDER_INSTANCE_ID);
  return [
    ...providers,
    {
      instanceId: ProviderInstanceId.make(V3_DEMO_RESPONDER_INSTANCE_ID),
      driver,
      displayName: V3_DEMO_RESPONDER_DISPLAY_NAME,
      showInteractionModeToggle: false,
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "1970-01-01T00:00:00.000Z",
      models: [
        {
          slug: V3_DEMO_RESPONDER_MODEL,
          name: V3_DEMO_RESPONDER_DISPLAY_NAME,
          shortName: V3_DEMO_RESPONDER_DISPLAY_NAME,
          isCustom: false,
          isDefault: true,
          capabilities: null,
        },
      ],
      slashCommands: [],
      skills: [],
    },
  ];
}

export function isV3DemoResponderTarget(input: {
  readonly enabled: boolean;
  readonly projectId: string | null | undefined;
  readonly threadId: string | null | undefined;
}): boolean {
  return (
    input.enabled && input.projectId === V3_DEMO_PROJECT_ID && input.threadId === V3_DEMO_THREAD_ID
  );
}
