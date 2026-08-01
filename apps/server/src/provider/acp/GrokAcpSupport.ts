import { type GrokSettings, ProviderDriverKind, type RuntimeMode } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import { normalizeModelSlug } from "@t3tools/shared/model";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import { makeXAiPromptCompletionRuntime } from "./XAiAcpExtension.ts";

const GROK_API_KEY_ENV = "XAI_API_KEY";
const GROK_OAUTH2_REFERRER_ENV = "GROK_OAUTH2_REFERRER";
const T3_CODE_OAUTH_REFERRER = "t3code";
const GROK_AUTH_METHOD_API_KEY = "xai.api_key";
const GROK_AUTH_METHOD_CACHED_TOKEN = "cached_token";
const GROK_DRIVER_KIND = ProviderDriverKind.make("grok");

/**
 * Values accepted by `grok --permission-mode` (top-level CLI flag, before the
 * `agent` subcommand). Only modes we intentionally drive from T3 are mapped;
 * Full access is deliberately omitted so we do not force always-approve at the
 * Grok process (client-side auto-approve remains the Full access path).
 */
export type GrokCliPermissionMode =
  | "default"
  | "acceptEdits"
  | "auto"
  | "dontAsk"
  | "bypassPermissions"
  | "plan";

type GrokAcpRuntimeGrokSettings = Pick<GrokSettings, "binaryPath">;

interface GrokAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly grokSettings: GrokAcpRuntimeGrokSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
  /**
   * T3 thread runtime mode. Used to opt Grok into its native Auto classifier
   * (`--permission-mode auto` / `autoMode`) when the thread is on Auto.
   * Full access does not get a native always-approve flag.
   */
  readonly runtimeMode?: RuntimeMode;
}

/**
 * CLI `--permission-mode` only when T3 must change Grok's native policy.
 * - Auto → classifier auto
 * - Auto-accept edits → acceptEdits
 * - Supervised → default (ask), so a sticky prior Auto session cannot linger
 * - Full access → undefined (do not pass bypassPermissions / always-approve)
 */
export function runtimeModeToGrokPermissionMode(
  runtimeMode: RuntimeMode,
): GrokCliPermissionMode | undefined {
  switch (runtimeMode) {
    case "auto-accept-edits":
      return "acceptEdits";
    case "auto":
      return "auto";
    case "approval-required":
      return "default";
    case "full-access":
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Grok ACP session `_meta` for permission policy.
 * Only Auto sets `autoMode`. Full access never sets `yoloMode` — that would
 * force always-approve inside Grok and is not what T3 Full access should do
 * at the process boundary (T3 still client-auto-approves permission RPCs).
 */
export function runtimeModeToGrokSessionMeta(
  runtimeMode: RuntimeMode,
): { readonly autoMode: boolean; readonly yoloMode: boolean } | undefined {
  switch (runtimeMode) {
    case "auto":
      return { autoMode: true, yoloMode: false };
    case "approval-required":
    case "auto-accept-edits":
      // Clear sticky Auto / yolo from a resumed or mode-switched session.
      return { autoMode: false, yoloMode: false };
    case "full-access":
      // Do not set yoloMode: true. Leave undefined so we do not force
      // always-approve at session setup.
      return undefined;
    default:
      return undefined;
  }
}

export function buildGrokAcpSpawnInput(
  grokSettings: GrokAcpRuntimeGrokSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  runtimeMode?: RuntimeMode,
): AcpSessionRuntime.AcpSpawnInput {
  // `--permission-mode` is a top-level `grok` flag; `grok agent` does not accept it.
  // Order: global options → `agent` → `stdio` (see `grok --help` / `grok agent --help`).
  const permissionMode =
    runtimeMode !== undefined ? runtimeModeToGrokPermissionMode(runtimeMode) : undefined;
  return {
    command: grokSettings?.binaryPath || "grok",
    args: [
      ...(permissionMode !== undefined ? (["--permission-mode", permissionMode] as const) : []),
      "agent",
      "stdio",
    ],
    cwd,
    env: {
      ...environment,
      [GROK_OAUTH2_REFERRER_ENV]: T3_CODE_OAUTH_REFERRER,
    },
  };
}

function resolveGrokAuthMethodId(environment: NodeJS.ProcessEnv | undefined): string {
  return environment?.[GROK_API_KEY_ENV]?.trim()
    ? GROK_AUTH_METHOD_API_KEY
    : GROK_AUTH_METHOD_CACHED_TOKEN;
}

export const makeGrokAcpRuntime = (
  input: GrokAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const sessionSetupMeta =
      input.runtimeMode !== undefined ? runtimeModeToGrokSessionMeta(input.runtimeMode) : undefined;
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildGrokAcpSpawnInput(
          input.grokSettings,
          input.cwd,
          input.environment,
          input.runtimeMode,
        ),
        ...(sessionSetupMeta ? { sessionSetupMeta } : {}),
        authMethodId: resolveGrokAuthMethodId(input.environment),
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    const runtime = yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
    return yield* makeXAiPromptCompletionRuntime(runtime);
  });

export function resolveGrokAcpBaseModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  const base = trimmed && trimmed.length > 0 ? trimmed : "grok-build";
  return normalizeModelSlug(base, GROK_DRIVER_KIND) ?? "grok-build";
}

export function currentGrokModelIdFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  return sessionSetupResult.models?.currentModelId?.trim() || undefined;
}

export function applyGrokAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setSessionModel">;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<string | undefined, E> {
  const shouldSwitchModel =
    input.requestedModelId !== undefined && input.requestedModelId !== input.currentModelId;
  if (!shouldSwitchModel) {
    return Effect.succeed(input.currentModelId);
  }
  return input.runtime
    .setSessionModel(input.requestedModelId)
    .pipe(Effect.mapError(input.mapError), Effect.as(input.requestedModelId));
}
