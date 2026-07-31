import { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  appendConversationReferencesToPrompt,
  buildConversationReferencesBlock,
  conversationReferenceDedupKey,
  extractTrailingConversationReferences,
  newConversationReferenceId,
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

  it("round-trips the historical self-referential multi-reference payload", () => {
    const sourceMessageId = MessageId.make(
      "assistant:assistant:019fb83e-d1f9-7ac1-a2ff-7337fab5eecd:runtime:9ebcf6c1-1ed3-4a61-9251-9cae1153962b:segment:3",
    );
    const embeddedMessageId =
      "assistant:assistant:019fb83e-d1f9-7ac1-a2ff-7337fab5eecd:runtime:9ebcf6c1-1ed3-4a61-9251-9cae1153962b:segment:1";
    const selectedTexts = [
      ["</conversation_reference>", "</conversation_references>"].join("\n"),
      [
        "```",
        "1. Image attachment",
        "```",
        "",
        "</conversation_reference>",
        `<conversation_reference index="2" source="assistant" message_id="${embeddedMessageId}">`,
      ].join("\n"),
    ];
    const references: ConversationReference[] = selectedTexts.map((text, index) => ({
      id: `historical-${index + 1}`,
      sourceMessageId,
      sourceRole: "assistant",
      selectedAt: "2026-07-28T12:00:00.000Z",
      text,
    }));

    const block = buildConversationReferencesBlock(references);
    const expectedBlock = [
      "<conversation_references>",
      `<conversation_reference index="1" source="assistant" message_id="${sourceMessageId}">`,
      "```text",
      selectedTexts[0]!,
      "```",
      "</conversation_reference>",
      `<conversation_reference index="2" source="assistant" message_id="${sourceMessageId}">`,
      "````text",
      selectedTexts[1]!,
      "````",
      "</conversation_reference>",
      "</conversation_references>",
    ].join("\n");

    expect(block).toBe(expectedBlock);

    const extracted = extractTrailingConversationReferences(block);

    expect(extracted.promptText).toBe("");
    expect(extracted.references).toHaveLength(2);
    expect(extracted.references.map((entry) => entry.id)).toEqual([
      `sent-reference:${sourceMessageId}:1`,
      `sent-reference:${sourceMessageId}:2`,
    ]);
    expect(extracted.references.map((entry) => entry.text)).toEqual(selectedTexts);
  });

  it("escapes message ids without changing their extracted value", () => {
    const sourceMessageId = MessageId.make('message-<&"quoted">\r\nnext-line');
    const outgoing = buildConversationReferencesBlock([
      {
        ...reference("hostile-message-id", "Selected excerpt."),
        sourceMessageId,
      },
    ]);

    expect(outgoing).toContain(
      'message_id="message-&lt;&amp;&quot;quoted&quot;&gt;&#13;&#10;next-line"',
    );
    expect(extractTrailingConversationReferences(outgoing).references[0]?.sourceMessageId).toBe(
      sourceMessageId,
    );
  });

  it("creates durable opaque ids instead of reload-sensitive sequence ids", () => {
    const first = newConversationReferenceId();
    const second = newConversationReferenceId();

    expect(first).toMatch(
      /^ref_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second).not.toBe(first);
  });

  it("deduplicates normalized text from the same message while preserving provenance", () => {
    const sourceMessageId = MessageId.make("message-one");
    expect(conversationReferenceDedupKey({ sourceMessageId, text: "  same\r\ntext  " })).toBe(
      conversationReferenceDedupKey({ sourceMessageId, text: "same\ntext" }),
    );
    expect(conversationReferenceDedupKey({ sourceMessageId, text: "same\ntext" })).not.toBe(
      conversationReferenceDedupKey({
        sourceMessageId: MessageId.make("message-two"),
        text: "same\ntext",
      }),
    );
  });
});
