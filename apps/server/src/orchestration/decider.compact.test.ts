import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-07-27T00:00:00.000Z";
const THREAD_ID = ThreadId.make("thread-compact");

const readModel: OrchestrationReadModel = {
  snapshotSequence: 0,
  projects: [],
  threads: [
    {
      id: THREAD_ID,
      projectId: ProjectId.make("project-1"),
      title: "Compact me",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6-sol",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    },
  ],
  updatedAt: NOW,
};

it.layer(NodeServices.layer)("context compaction decider", (it) => {
  it.effect("emits a provider compaction intent for an existing thread", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.context.compact",
          commandId: CommandId.make("compact-command"),
          threadId: THREAD_ID,
          createdAt: NOW,
        },
        readModel,
      });
      const events = Array.isArray(result) ? result : [result];

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("thread.context-compact-requested");
      if (events[0]?.type === "thread.context-compact-requested") {
        expect(events[0].payload).toEqual({
          threadId: THREAD_ID,
          createdAt: NOW,
        });
      }
    }),
  );
});
