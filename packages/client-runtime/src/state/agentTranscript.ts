import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createAgentTranscriptEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    transcript: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:agents:transcript",
      tag: WS_METHODS.agentGetTranscript,
      staleTimeMs: 2_000,
      idleTtlMs: 5 * 60_000,
    }),
  };
}
