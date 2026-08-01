import { createTextGenerationUsageEnvironmentAtoms } from "@t3tools/client-runtime/state/textGenerationUsage";

import { connectionAtomRuntime } from "../connection/runtime";

export const textGenerationUsageEnvironment =
  createTextGenerationUsageEnvironmentAtoms(connectionAtomRuntime);
