import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

export function createTextGenerationUsageEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    getUsage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:textGeneration:get-usage",
      tag: WS_METHODS.textGenerationGetUsage,
      concurrency: {
        mode: "latest",
        key: (target) => `${target.environmentId}:${target.input.window}`,
      },
    }),
  };
}
