import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type {
  ChatAttachment,
  ModelSelection,
  SuggestNextPromptInput,
  SuggestNextPromptResult,
  ThreadId,
} from "@t3tools/contracts";
import { SuggestNextPromptError } from "@t3tools/contracts";
import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";

const MAX_CONTEXT_CHARS = 12_000;
const MAX_MESSAGES = 12;

function formatConversationContext(
  messages: ReadonlyArray<{
    readonly role: "user" | "assistant" | "system";
    readonly text: string;
    readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
  }>,
): string {
  const relevant = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-MAX_MESSAGES);

  let context = "";
  for (const message of relevant) {
    const text = message.text.trim();
    const attachmentSummary = (message.attachments ?? [])
      .map((attachment) => attachment.name)
      .join(", ");
    const contents = [
      ...(text.length > 0 ? [text] : []),
      ...(attachmentSummary.length > 0 ? [`[Attachments: ${attachmentSummary}]`] : []),
    ].join("\n");
    if (contents.length === 0) continue;

    const section = `${message.role.toUpperCase()}:\n${contents}`;
    const separator = context.length > 0 ? "\n\n" : "";
    const next = `${context}${separator}${section}`;
    if (next.length > MAX_CONTEXT_CHARS) {
      // Prefer the end of the conversation when over budget.
      const overflow = next.length - MAX_CONTEXT_CHARS;
      context = next.slice(overflow);
      if (!context.startsWith("USER:") && !context.startsWith("ASSISTANT:")) {
        const cut = context.indexOf("\n\n");
        context = cut >= 0 ? context.slice(cut + 2) : context;
      }
      continue;
    }
    context = next;
  }

  return context.trim();
}

export const suggestNextPrompt = Effect.fn("suggestNextPrompt")(function* (
  input: SuggestNextPromptInput,
) {
  const projection = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const crypto = yield* Crypto.Crypto;

  const threadId = input.threadId as ThreadId;
  const threadOption = yield* projection.getThreadDetailById(threadId).pipe(
    Effect.mapError(
      () =>
        new SuggestNextPromptError({
          message: "Failed to load the thread for a next-prompt suggestion.",
        }),
    ),
  );

  if (Option.isNone(threadOption)) {
    return {
      suggestion: null,
      generationId: crypto.randomUUID(),
    } satisfies SuggestNextPromptResult;
  }
  const thread = threadOption.value;

  // Only suggest when the main session is idle — not mid-turn.
  if (thread.session?.status === "running") {
    return {
      suggestion: null,
      generationId: crypto.randomUUID(),
    } satisfies SuggestNextPromptResult;
  }

  const conversation = formatConversationContext(thread.messages);
  if (conversation.length === 0) {
    return {
      suggestion: null,
      generationId: crypto.randomUUID(),
    } satisfies SuggestNextPromptResult;
  }

  const projectOption = yield* projection.getProjectShellById(thread.projectId).pipe(
    Effect.mapError(
      () =>
        new SuggestNextPromptError({
          message: "Failed to load the project for a next-prompt suggestion.",
        }),
    ),
  );
  const project = Option.getOrNull(projectOption);

  const cwd =
    resolveThreadWorkspaceCwd({
      thread,
      projects: project ? [project] : [],
    }) ?? process.cwd();

  const { textGenerationModelSelection: modelSelection } = yield* serverSettings.getSettings;
  if (!modelSelection?.instanceId || !modelSelection.model) {
    return {
      suggestion: null,
      generationId: crypto.randomUUID(),
    } satisfies SuggestNextPromptResult;
  }

  const generated = yield* textGeneration
    .generatePromptSuggestion({
      cwd,
      conversation,
      modelSelection: modelSelection as ModelSelection,
    })
    .pipe(
      Effect.catch(() =>
        Effect.succeed({
          suggestion: null as string | null,
        }),
      ),
    );

  return {
    suggestion: generated.suggestion,
    generationId: crypto.randomUUID(),
  } satisfies SuggestNextPromptResult;
});
