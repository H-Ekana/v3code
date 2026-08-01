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

/**
 * The signal for "what would the user type next" lives almost entirely in the
 * tail of the assistant's last message — that is where an agent puts its offer
 * ("Want me to run them?") or its handoff ("left it uncommitted"). Sending the
 * whole recent transcript cost thousands of tokens per settled turn to produce
 * a handful of words, so we send only:
 *
 *   - the last user message (intent + tone to match), tightly capped
 *   - the closing paragraphs of the last assistant message
 */
const MAX_ASSISTANT_TAIL_PARAGRAPHS = 2;
const MAX_ASSISTANT_TAIL_CHARS = 1_200;
const MAX_USER_MESSAGE_CHARS = 500;

/** Last N paragraphs of a message, capped, keeping the END of the text. */
function takeClosingParagraphs(text: string, paragraphs: number, maxChars: number): string {
  const blocks = text
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  let tail = blocks.slice(-paragraphs).join("\n\n");
  if (tail.length === 0) tail = text.trim();
  if (tail.length <= maxChars) return tail;

  // Over budget: keep the end, then drop a partial leading line.
  const clipped = tail.slice(tail.length - maxChars);
  const firstBreak = clipped.indexOf("\n");
  return (firstBreak >= 0 ? clipped.slice(firstBreak + 1) : clipped).trim();
}

/** Keep the end of a user message — the ask usually lands last. */
function takeMessageTail(text: string, maxChars: number): string {
  const trimmed = text.trim();
  return trimmed.length <= maxChars ? trimmed : trimmed.slice(trimmed.length - maxChars).trim();
}

export function formatConversationContext(
  messages: ReadonlyArray<{
    readonly role: "user" | "assistant" | "system";
    readonly text: string;
    readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
  }>,
): string {
  const relevant = messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );

  const lastAssistant = relevant.findLast((message) => message.role === "assistant");
  const lastUser = relevant.findLast((message) => message.role === "user");

  const sections: string[] = [];

  if (lastUser) {
    const attachmentSummary = (lastUser.attachments ?? [])
      .map((attachment) => attachment.name)
      .join(", ");
    const contents = [
      ...(lastUser.text.trim().length > 0
        ? [takeMessageTail(lastUser.text, MAX_USER_MESSAGE_CHARS)]
        : []),
      ...(attachmentSummary.length > 0 ? [`[Attachments: ${attachmentSummary}]`] : []),
    ].join("\n");
    if (contents.length > 0) sections.push(`USER:\n${contents}`);
  }

  if (lastAssistant && lastAssistant.text.trim().length > 0) {
    const tail = takeClosingParagraphs(
      lastAssistant.text,
      MAX_ASSISTANT_TAIL_PARAGRAPHS,
      MAX_ASSISTANT_TAIL_CHARS,
    );
    if (tail.length > 0) sections.push(`ASSISTANT (end of reply):\n${tail}`);
  }

  return sections.join("\n\n").trim();
}

export const suggestNextPrompt = Effect.fn("suggestNextPrompt")(function* (
  input: SuggestNextPromptInput,
) {
  const projection = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const crypto = yield* Crypto.Crypto;

  // Correlation id only (see the contract): generated once and reused by every
  // exit below. A UUID failure must not fail the RPC, so it falls back.
  const generationId = yield* crypto.randomUUIDv4.pipe(
    Effect.orElseSucceed(() => "prompt-suggestion"),
  );

  const threadId = input.threadId as ThreadId;

  // Settings failures fail closed like every other soft failure here: the
  // composer simply shows no ghost. They are not part of the RPC error union.
  const settings = yield* serverSettings.getSettings.pipe(Effect.orElseSucceed(() => null));

  // Opt-in feature, OFF by default — checked before any other work so a user
  // who has not enabled it spends nothing at all.
  if (settings?.promptSuggestionsEnabled !== true) {
    yield* Effect.logInfo("No next-prompt suggestion.", {
      reason: "prompt-suggestions-disabled",
      threadId,
    });
    return {
      suggestion: null,
      generationId,
    } satisfies SuggestNextPromptResult;
  }

  const threadOption = yield* projection.getThreadDetailById(threadId).pipe(
    Effect.mapError(
      () =>
        new SuggestNextPromptError({
          message: "Failed to load the thread for a next-prompt suggestion.",
        }),
    ),
  );

  if (Option.isNone(threadOption)) {
    yield* Effect.logInfo("No next-prompt suggestion.", { reason: "thread-not-found", threadId });
    return {
      suggestion: null,
      generationId,
    } satisfies SuggestNextPromptResult;
  }
  const thread = threadOption.value;

  // Only suggest when the main session is idle — not mid-turn.
  if (thread.session?.status === "running") {
    yield* Effect.logInfo("No next-prompt suggestion.", {
      reason: "session-still-running",
      threadId,
    });
    return {
      suggestion: null,
      generationId,
    } satisfies SuggestNextPromptResult;
  }

  const conversation = formatConversationContext(thread.messages);
  if (conversation.length === 0) {
    yield* Effect.logInfo("No next-prompt suggestion.", {
      reason: "empty-conversation",
      threadId,
      messageCount: thread.messages.length,
    });
    return {
      suggestion: null,
      generationId,
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

  const modelSelection = settings?.textGenerationModelSelection;
  if (!modelSelection?.instanceId || !modelSelection.model) {
    yield* Effect.logInfo("No next-prompt suggestion.", {
      reason: "text-generation-model-not-configured",
      threadId,
    });
    return {
      suggestion: null,
      generationId,
    } satisfies SuggestNextPromptResult;
  }

  const generated = yield* textGeneration
    .generatePromptSuggestion({
      cwd,
      conversation,
      modelSelection: modelSelection as ModelSelection,
    })
    .pipe(
      Effect.tapError((cause) =>
        Effect.logWarning("Next-prompt suggestion generation failed.", {
          reason: "generation-failed",
          threadId,
          cause,
        }),
      ),
      Effect.orElseSucceed(() => ({ suggestion: null as string | null })),
    );

  if (generated.suggestion === null) {
    yield* Effect.logInfo("No next-prompt suggestion.", {
      reason: "model-returned-nothing-or-sanitizer-rejected",
      threadId,
      model: modelSelection.model,
    });
  } else {
    yield* Effect.logInfo("Next-prompt suggestion ready.", {
      threadId,
      suggestion: generated.suggestion,
    });
  }

  return {
    suggestion: generated.suggestion,
    generationId,
  } satisfies SuggestNextPromptResult;
});
