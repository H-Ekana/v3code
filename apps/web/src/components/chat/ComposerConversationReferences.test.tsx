import { MessageId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { ConversationReference } from "../../conversationReference";
import {
  ComposerConversationReferences,
  ConversationReferenceList,
} from "./ComposerConversationReferences";

const references: ConversationReference[] = [
  {
    id: "ref-1",
    sourceMessageId: MessageId.make("message-1"),
    sourceRole: "assistant",
    selectedAt: "2026-07-28T12:00:00.000Z",
    text: "First selected excerpt.",
  },
  {
    id: "ref-2",
    sourceMessageId: MessageId.make("message-2"),
    sourceRole: "user",
    selectedAt: "2026-07-28T12:01:00.000Z",
    text: "Second selected excerpt.",
  },
];

describe("ComposerConversationReferences", () => {
  it("uses reference terminology and exposes the ordered tray", () => {
    const triggerMarkup = renderToStaticMarkup(
      <ComposerConversationReferences references={references} onRemove={vi.fn()} />,
    );
    const listMarkup = renderToStaticMarkup(
      <ConversationReferenceList references={references} onRemove={vi.fn()} />,
    );

    expect(triggerMarkup).toContain("2 references");
    expect(triggerMarkup).toContain("Show referenced text");
    expect(listMarkup.indexOf("First selected excerpt.")).toBeLessThan(
      listMarkup.indexOf("Second selected excerpt."),
    );
    expect(listMarkup).toContain("Remove reference 1");
    expect(listMarkup).toContain("Remove reference 2");
    expect(listMarkup).toContain("hover:text-destructive");
  });
});
