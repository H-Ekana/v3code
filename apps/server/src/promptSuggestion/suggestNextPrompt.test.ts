import { describe, expect, it } from "vite-plus/test";

import { formatConversationContext } from "./suggestNextPrompt.ts";

type Message = Parameters<typeof formatConversationContext>[0][number];

function message(role: Message["role"], text: string): Message {
  return { role, text };
}

describe("formatConversationContext", () => {
  it("sends only the last user message and the end of the last assistant reply", () => {
    const context = formatConversationContext([
      message("user", "first ask"),
      message("assistant", "first answer"),
      message("user", "second ask"),
      message("assistant", "opening paragraph\n\nclosing paragraph"),
    ]);

    expect(context).toContain("USER:\nsecond ask");
    expect(context).toContain("closing paragraph");
    // Earlier turns are not worth the tokens — the signal is in the tail.
    expect(context).not.toContain("first ask");
    expect(context).not.toContain("first answer");
  });

  it("keeps the closing paragraphs where an agent puts its offer", () => {
    const reply = ["long preamble", "more detail", "middle paragraph", "Want me to run them?"].join(
      "\n\n",
    );
    const context = formatConversationContext([
      message("user", "list the tests"),
      message("assistant", reply),
    ]);

    expect(context).toContain("Want me to run them?");
    expect(context).toContain("middle paragraph");
    expect(context).not.toContain("long preamble");
  });

  it("drops system messages", () => {
    const context = formatConversationContext([
      message("system", "system noise"),
      message("user", "do the thing"),
      message("assistant", "done"),
    ]);

    expect(context).not.toContain("system noise");
    expect(context).toContain("do the thing");
  });

  it("caps a huge assistant reply and keeps the end of it", () => {
    const reply = `${"x".repeat(50_000)}\n\nfinal line here`;
    const context = formatConversationContext([message("user", "go"), message("assistant", reply)]);

    expect(context).toContain("final line here");
    expect(context.length).toBeLessThan(2_500);
  });

  it("caps a huge user message and keeps the end of it", () => {
    const ask = `${"y".repeat(50_000)} the actual question`;
    const context = formatConversationContext([message("user", ask)]);

    expect(context).toContain("the actual question");
    expect(context.length).toBeLessThan(1_000);
  });

  it("returns empty when there is nothing to go on", () => {
    expect(formatConversationContext([])).toBe("");
    expect(formatConversationContext([message("assistant", "   ")])).toBe("");
  });

  it("notes attachments on the last user message", () => {
    const context = formatConversationContext([
      { role: "user", text: "look at this", attachments: [{ name: "screenshot.png" }] as never },
      message("assistant", "looking"),
    ]);

    expect(context).toContain("[Attachments: screenshot.png]");
  });
});
