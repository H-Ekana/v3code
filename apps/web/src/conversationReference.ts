import { MessageId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const ConversationReferenceRole = Schema.Literals(["user", "assistant"]);
export type ConversationReferenceRole = typeof ConversationReferenceRole.Type;

export const ConversationReferenceSchema = Schema.Struct({
  id: Schema.String,
  sourceMessageId: MessageId,
  sourceRole: ConversationReferenceRole,
  selectedAt: Schema.String,
  text: Schema.String,
});
export interface ConversationReference {
  readonly id: string;
  readonly sourceMessageId: MessageId;
  readonly sourceRole: ConversationReferenceRole;
  readonly selectedAt: string;
  readonly text: string;
}

export interface ConversationReferenceSelection {
  readonly sourceMessageId: MessageId;
  readonly sourceRole: ConversationReferenceRole;
  readonly text: string;
}

export interface ExtractedConversationReferences {
  readonly promptText: string;
  readonly references: ReadonlyArray<ConversationReference>;
}

const TRAILING_CONVERSATION_REFERENCES_PATTERN =
  /\n*<conversation_references>\n([\s\S]*?)\n<\/conversation_references>\s*$/;
const CONVERSATION_REFERENCE_PATTERN =
  /<conversation_reference index="(\d+)" source="(user|assistant)" message_id="([^"]+)">\n(`{3,})text\n([\s\S]*?)\n\4\n<\/conversation_reference>/g;

let nextConversationReferenceSequence = 0;

export function newConversationReferenceId(): string {
  nextConversationReferenceSequence += 1;
  return `ref_${nextConversationReferenceSequence.toString(36)}`;
}

export function normalizeConversationReferenceText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

export function conversationReferenceDedupKey(
  reference: Pick<ConversationReference, "text">,
): string {
  return normalizeConversationReferenceText(reference.text);
}

export function createConversationReference(
  selection: ConversationReferenceSelection,
): ConversationReference {
  return {
    id: newConversationReferenceId(),
    sourceMessageId: selection.sourceMessageId,
    sourceRole: selection.sourceRole,
    selectedAt: new Date().toISOString(),
    text: normalizeConversationReferenceText(selection.text),
  };
}

function longestBacktickRun(value: string): number {
  return Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
}

function formatConversationReference(reference: ConversationReference, index: number): string {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(reference.text) + 1));
  return [
    `<conversation_reference index="${index + 1}" source="${reference.sourceRole}" message_id="${reference.sourceMessageId}">`,
    `${fence}text`,
    reference.text,
    fence,
    "</conversation_reference>",
  ].join("\n");
}

export function buildConversationReferencesBlock(
  references: ReadonlyArray<ConversationReference>,
): string {
  if (references.length === 0) return "";
  return [
    "<conversation_references>",
    references.map(formatConversationReference).join("\n"),
    "</conversation_references>",
  ].join("\n");
}

export function appendConversationReferencesToPrompt(
  prompt: string,
  references: ReadonlyArray<ConversationReference>,
): string {
  const block = buildConversationReferencesBlock(references);
  if (block.length === 0) return prompt;
  const trimmedPrompt = prompt.trim();
  return trimmedPrompt.length > 0 ? `${trimmedPrompt}\n\n${block}` : block;
}

export function extractTrailingConversationReferences(
  prompt: string,
): ExtractedConversationReferences {
  const outerMatch = TRAILING_CONVERSATION_REFERENCES_PATTERN.exec(prompt);
  if (!outerMatch) {
    return { promptText: prompt, references: [] };
  }

  const references: ConversationReference[] = [];
  for (const match of (outerMatch[1] ?? "").matchAll(CONVERSATION_REFERENCE_PATTERN)) {
    const sourceRole = match[2];
    const sourceMessageId = match[3];
    if ((sourceRole !== "user" && sourceRole !== "assistant") || !sourceMessageId || !match[5]) {
      continue;
    }
    references.push({
      id: `sent-reference:${sourceMessageId}:${match[1] ?? references.length + 1}`,
      sourceMessageId: MessageId.make(sourceMessageId),
      sourceRole,
      selectedAt: "",
      text: match[5],
    });
  }

  if (references.length === 0) {
    return { promptText: prompt, references: [] };
  }

  return {
    promptText: prompt.slice(0, outerMatch.index).replace(/\n+$/, ""),
    references,
  };
}
