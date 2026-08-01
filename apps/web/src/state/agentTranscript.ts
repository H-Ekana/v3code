import { createAgentTranscriptEnvironmentAtoms } from "@t3tools/client-runtime/state/agent-transcript";

import { connectionAtomRuntime } from "../connection/runtime";

export const agentTranscriptEnvironment =
  createAgentTranscriptEnvironmentAtoms(connectionAtomRuntime);
