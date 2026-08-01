import { describe, expect, it } from "vite-plus/test";

import { isInsideFencedCodeBlock, planListContinuation } from "./composerListContinuation";

describe("planListContinuation", () => {
  it("continues an ordered list with 1. style", () => {
    const text = "1. first";
    expect(planListContinuation(text, text.length)).toEqual({
      kind: "continue",
      insertText: "\n2. ",
    });
  });

  it("continues an ordered list with 1) style", () => {
    const text = "1) first";
    expect(planListContinuation(text, text.length)).toEqual({
      kind: "continue",
      insertText: "\n2) ",
    });
  });

  it("increments multi-digit markers and keeps alignment spaces", () => {
    const text = "9. item";
    expect(planListContinuation(text, text.length)).toEqual({
      kind: "continue",
      insertText: "\n10. ",
    });
  });

  it("preserves leading indent on ordered lists", () => {
    const text = "  3. nested";
    expect(planListContinuation(text, text.length)).toEqual({
      kind: "continue",
      insertText: "\n  4. ",
    });
  });

  it("continues unordered bullets and preserves the marker character", () => {
    expect(planListContinuation("- a", 3)).toEqual({ kind: "continue", insertText: "\n- " });
    expect(planListContinuation("* a", 3)).toEqual({ kind: "continue", insertText: "\n* " });
    expect(planListContinuation("+ a", 3)).toEqual({ kind: "continue", insertText: "\n+ " });
  });

  it("preserves indent on bullets", () => {
    const text = "    - nested";
    expect(planListContinuation(text, text.length)).toEqual({
      kind: "continue",
      insertText: "\n    - ",
    });
  });

  it("resets checked task boxes on the next line", () => {
    const text = "- [x] done";
    expect(planListContinuation(text, text.length)).toEqual({
      kind: "continue",
      insertText: "\n- [ ] ",
    });
  });

  it("continues ordered task lists unchecked", () => {
    const text = "1. [X] done";
    expect(planListContinuation(text, text.length)).toEqual({
      kind: "continue",
      insertText: "\n2. [ ] ",
    });
  });

  it("splits mid-line content onto the next list item", () => {
    const text = "1. abcd";
    // cursor between b and c → "1. ab|cd"
    expect(planListContinuation(text, 5)).toEqual({
      kind: "continue",
      insertText: "\n2. ",
    });
  });

  it("exits an empty ordered list item by deleting the marker", () => {
    const text = "1. item\n2. ";
    expect(planListContinuation(text, text.length)).toEqual({
      kind: "exit",
      deleteFrom: "1. item\n".length,
      deleteTo: text.length,
    });
  });

  it("exits an empty bullet list item", () => {
    const text = "- a\n- ";
    expect(planListContinuation(text, text.length)).toEqual({
      kind: "exit",
      deleteFrom: "- a\n".length,
      deleteTo: text.length,
    });
  });

  it("exits an empty task list item", () => {
    const text = "- [ ] ";
    expect(planListContinuation(text, text.length)).toEqual({
      kind: "exit",
      deleteFrom: 0,
      deleteTo: text.length,
    });
  });

  it("does not treat missing space after the marker as a list", () => {
    expect(planListContinuation("1.foo", 5)).toEqual({ kind: "none" });
    expect(planListContinuation("-foo", 4)).toEqual({ kind: "none" });
  });

  it("does not continue plain prose", () => {
    expect(planListContinuation("hello", 5)).toEqual({ kind: "none" });
    expect(planListContinuation("see 1. note", 11)).toEqual({ kind: "none" });
  });

  it("does not continue inside a fenced code block", () => {
    const text = "```\n1. not a list";
    expect(planListContinuation(text, text.length)).toEqual({ kind: "none" });
  });

  it("continues again after a closed fence", () => {
    const text = "```\ncode\n```\n1. after";
    expect(planListContinuation(text, text.length)).toEqual({
      kind: "continue",
      insertText: "\n2. ",
    });
  });

  it("works on the first line of a multi-line composer value", () => {
    const text = "1. a\nplain";
    expect(planListContinuation(text, 4)).toEqual({
      kind: "continue",
      insertText: "\n2. ",
    });
  });
});

describe("isInsideFencedCodeBlock", () => {
  it("detects open fences", () => {
    expect(isInsideFencedCodeBlock("```\n1. x", 6)).toBe(true);
  });

  it("clears after a matching close fence", () => {
    expect(isInsideFencedCodeBlock("```\nx\n```\n1. x", 12)).toBe(false);
  });

  it("ignores the incomplete current line when deciding fence state", () => {
    // Cursor on a line that looks like a fence open — not yet a completed line.
    expect(isInsideFencedCodeBlock("```", 3)).toBe(false);
  });
});
