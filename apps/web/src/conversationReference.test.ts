import { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  appendConversationReferencesToPrompt,
  buildConversationReferencesBlock,
  conversationReferenceDedupKey,
  extractTrailingConversationReferences,
  type ConversationReference,
} from "./conversationReference";

function reference(
  id: string,
  text: string,
  sourceRole: ConversationReference["sourceRole"] = "assistant",
): ConversationReference {
  return {
    id,
    sourceMessageId: MessageId.make(`message-${id}`),
    sourceRole,
    selectedAt: "2026-07-28T12:00:00.000Z",
    text,
  };
}

describe("conversation references", () => {
  it("serializes references in their selected order", () => {
    const block = buildConversationReferencesBlock([
      reference("one", "First excerpt."),
      reference("two", "Second excerpt.", "user"),
    ]);

    expect(block.indexOf("First excerpt.")).toBeLessThan(block.indexOf("Second excerpt."));
    expect(block).toContain('index="1" source="assistant"');
    expect(block).toContain('index="2" source="user"');
  });

  it("round-trips selected text containing markdown fences and XML-like text", () => {
    const references = [
      reference("one", 'Use this:\n```ts\nconst tag = "</conversation_reference>";\n```'),
    ];
    const outgoing = appendConversationReferencesToPrompt("Please update this.", references);
    const extracted = extractTrailingConversationReferences(outgoing);

    expect(extracted.promptText).toBe("Please update this.");
    expect(extracted.references.map((entry) => entry.text)).toEqual(
      references.map((entry) => entry.text),
    );
  });

  it("normalizes line endings and edge whitespace for duplicate detection", () => {
    expect(conversationReferenceDedupKey({ text: "  same\r\ntext  " })).toBe(
      conversationReferenceDedupKey({ text: "same\ntext" }),
    );
  });
});
