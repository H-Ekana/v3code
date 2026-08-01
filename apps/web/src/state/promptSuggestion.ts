import { createPromptSuggestionEnvironmentAtoms } from "@t3tools/client-runtime/state/promptSuggestion";

import { connectionAtomRuntime } from "../connection/runtime";

export const promptSuggestionEnvironment =
  createPromptSuggestionEnvironmentAtoms(connectionAtomRuntime);
