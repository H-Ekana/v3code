import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

export function createPromptSuggestionEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    suggestNextPrompt: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread:suggest-next-prompt",
      tag: WS_METHODS.threadSuggestNextPrompt,
      concurrency: {
        mode: "latest",
        key: (target) => `${target.environmentId}:${target.input.threadId}`,
      },
    }),
  };
}
