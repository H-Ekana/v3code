import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vite-plus/test";

import { remarkNormalizeListItemIndentation } from "./markdown-list-indentation";
import {
  explainIncrementalMarkdownSplit,
  isSplitSafeBoundaryLine,
  planIncrementalMarkdownSplit,
  type IncrementalMarkdownOptions,
} from "./markdown-incremental";

// ChatMarkdown does not export its transformer or its sanitize schema, so both
// are mirrored here the same way scripts/bench-streaming-render.mjs mirrors
// them. Keep them byte-for-byte equivalent to ChatMarkdown.tsx: this suite is
// only meaningful if it exercises the real plugin chain.
function remarkPreserveCodeMeta() {
  return (tree: { type?: string; meta?: unknown; data?: unknown; children?: unknown[] }) => {
    const visit = (node: Record<string, unknown>) => {
      if (node.type === "code" && typeof node.meta === "string" && node.meta.trim().length > 0) {
        const data = (node.data ?? {}) as Record<string, unknown>;
        node.data = {
          ...data,
          hProperties: {
            ...((data.hProperties ?? {}) as Record<string, unknown>),
            dataCodeMeta: node.meta.trim(),
          },
        };
      }
      for (const child of (node.children as Record<string, unknown>[] | undefined) ?? []) {
        visit(child);
      }
    };

    visit(tree as Record<string, unknown>);
  };
}

const chatMarkdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": (defaultSchema.attributes?.["*"] ?? []).filter((attribute) => attribute !== "title"),
    code: [...(defaultSchema.attributes?.code ?? []), "dataCodeMeta"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "file"],
  },
};

const remarkPlugins = [remarkGfm, remarkNormalizeListItemIndentation, remarkPreserveCodeMeta];
const rehypePlugins = [rehypeRaw, [rehypeSanitize, chatMarkdownSanitizeSchema]];

function render(markdown: string): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, {
      remarkPlugins,
      rehypePlugins,
      children: markdown,
    } as never),
  );
}

/**
 * Renders every planned chunk separately and concatenates, exactly as
 * ChatMarkdown's `MarkdownSegment` list does — including the "\n" text node
 * `mdast-util-to-hast` places between root-level blocks, which each chunk but
 * the last has to re-emit.
 */
function renderIncrementally(markdown: string, options?: IncrementalMarkdownOptions): string {
  const split = planIncrementalMarkdownSplit(markdown, options);
  if (!split) return render(markdown);
  return [
    ...split.segments.map((segment) => `${render(segment.source)}\n`),
    render(split.tail.source),
  ].join("");
}

/** Aggressive settings so short fixtures still exercise the boundary rules. */
const EAGER: IncrementalMarkdownOptions = { minTextLength: 32, minSegmentLength: 16 };

function expectSplitIsTransparent(markdown: string, options = EAGER): void {
  const split = planIncrementalMarkdownSplit(markdown, options);
  if (split) {
    expect(split.segments.map((segment) => segment.source).join("") + split.tail.source).toBe(
      markdown,
    );
    let expectedOffset = 0;
    for (const chunk of [...split.segments, split.tail]) {
      expect(chunk.offset).toBe(expectedOffset);
      expectedOffset += chunk.source.length;
    }
  }
  expect(renderIncrementally(markdown, options)).toBe(render(markdown));
}

/** Replays `markdown` as a stream and checks every intermediate frame. */
function expectStreamingIsTransparent(markdown: string, step = 17, options = EAGER): void {
  for (let end = 1; end <= markdown.length; end += step) {
    const frame = markdown.slice(0, end);
    expect(renderIncrementally(frame, options), `frame of length ${end}`).toBe(render(frame));
  }
  expect(renderIncrementally(markdown, options)).toBe(render(markdown));
}

describe("isSplitSafeBoundaryLine", () => {
  it("accepts plain column-zero block starts", () => {
    expect(isSplitSafeBoundaryLine("A plain paragraph line.")).toBe(true);
    expect(isSplitSafeBoundaryLine("## A heading")).toBe(true);
    expect(isSplitSafeBoundaryLine("> a block quote")).toBe(true);
    expect(isSplitSafeBoundaryLine("| a | b |")).toBe(true);
    expect(isSplitSafeBoundaryLine("```ts")).toBe(true);
    expect(isSplitSafeBoundaryLine("===")).toBe(true);
  });

  it("rejects list markers on either side of a blank line", () => {
    expect(isSplitSafeBoundaryLine("- item")).toBe(false);
    expect(isSplitSafeBoundaryLine("* item")).toBe(false);
    expect(isSplitSafeBoundaryLine("+ item")).toBe(false);
    expect(isSplitSafeBoundaryLine("1. item")).toBe(false);
    expect(isSplitSafeBoundaryLine("12) item")).toBe(false);
    // A bare marker is a valid empty list item, and it is also the prefix of a
    // longer line, so it must stay unsafe until the line is complete.
    expect(isSplitSafeBoundaryLine("-")).toBe(false);
    expect(isSplitSafeBoundaryLine("1.")).toBe(false);
  });

  it("rejects indented lines, which may be list continuation or indented code", () => {
    expect(isSplitSafeBoundaryLine("    code")).toBe(false);
    expect(isSplitSafeBoundaryLine("\tcode")).toBe(false);
    expect(isSplitSafeBoundaryLine("  continuation of a list item")).toBe(false);
  });
});

describe("planIncrementalMarkdownSplit", () => {
  it("refuses short messages", () => {
    expect(explainIncrementalMarkdownSplit("hello\n\nworld\n\nagain\n").refusal).toBe("too-short");
  });

  it("splits plain prose and renders identically", () => {
    const markdown = [
      "# Title",
      "",
      "First paragraph of the answer, long enough to matter.",
      "",
      "## A section",
      "",
      "Second paragraph with *emphasis*, **strong**, and ~~strike~~.",
      "",
      "Third paragraph that is still being written",
    ].join("\n");

    const split = planIncrementalMarkdownSplit(markdown, EAGER);
    expect(split).not.toBeNull();
    expect(split!.segments.length).toBeGreaterThan(0);
    expectSplitIsTransparent(markdown);
    expectStreamingIsTransparent(markdown);
  });
});

describe("hazards that force the whole string to be rendered", () => {
  it("refuses a reference-style link whose definition arrives after its use", () => {
    const markdown = [
      "The reducer is documented in [the reducer][ref] which explains the flow.",
      "",
      "Another paragraph so a blank-line boundary exists at all.",
      "",
      "[ref]: /repo/src/state/threadReducer.ts",
      "",
      "Trailing paragraph.",
    ].join("\n");

    expect(explainIncrementalMarkdownSplit(markdown, EAGER).refusal).toBe(
      "link-reference-definition",
    );
    expect(planIncrementalMarkdownSplit(markdown, EAGER)).toBeNull();
    expectStreamingIsTransparent(markdown);
  });

  it("refuses footnotes, whose definitions render as a trailing section", () => {
    const markdown = [
      "The tradeoff is described in the design note.[^1]",
      "",
      "A second paragraph, long enough to offer a boundary.",
      "",
      "[^1]: The design note lives in docs/project.",
      "",
      "Closing paragraph.",
    ].join("\n");

    expect(explainIncrementalMarkdownSplit(markdown, EAGER).refusal).toBe("footnote");
    expectStreamingIsTransparent(markdown);
  });

  it("refuses raw HTML, which rehype-raw re-parses across the whole tree", () => {
    const markdown = [
      "<details><summary>Note</summary>",
      "",
      "Raw HTML is passed through rehype-raw and then sanitized.",
      "",
      "</details>",
      "",
      "A paragraph after the details block.",
    ].join("\n");

    expect(explainIncrementalMarkdownSplit(markdown, EAGER).refusal).toBe("raw-html");
    expectStreamingIsTransparent(markdown);
  });

  it("refuses an unclosed HTML tag", () => {
    const markdown = [
      "A paragraph before the markup.",
      "",
      "<div class='callout'>",
      "",
      "Content that the open div swallows in a whole-document parse.",
      "",
      "A trailing paragraph.",
    ].join("\n");

    expect(explainIncrementalMarkdownSplit(markdown, EAGER).refusal).toBe("raw-html");
    expectStreamingIsTransparent(markdown);
  });

  it("refuses when the only blank lines sit inside a list", () => {
    const markdown = [
      "- the first consequence of the change",
      "",
      "- the second consequence of the change",
      "",
      "- the third consequence of the change",
    ].join("\n");

    expect(explainIncrementalMarkdownSplit(markdown, EAGER).refusal).toBe("no-safe-boundary");
    expectStreamingIsTransparent(markdown);
  });

  it("refuses a boundary where a lazy continuation hides an open list item", () => {
    // A whole-document parse joins these into ONE loose list; splitting at the
    // blank line would produce two tight lists. The line before the blank looks
    // like an ordinary paragraph, so the list-marker check on the line *after*
    // the blank is what saves this case.
    const markdown = [
      "1. the first item of an ordered list",
      "a lazy continuation line that sits at column zero",
      "",
      "1. the second item of the very same list",
      "another lazy continuation line at column zero",
    ].join("\n");

    expect(explainIncrementalMarkdownSplit(markdown, EAGER).refusal).toBe("no-safe-boundary");
    expectStreamingIsTransparent(markdown);
  });

  it("refuses a boundary between two indented code chunks", () => {
    const markdown = [
      "    const first = 1;",
      "",
      "    const second = 2;",
      "",
      "    const third = 3;",
    ].join("\n");

    expect(explainIncrementalMarkdownSplit(markdown, EAGER).refusal).toBe("no-safe-boundary");
    expectStreamingIsTransparent(markdown);
  });
});

describe("constructs that are safe to split around", () => {
  it("never cuts inside an open fence", () => {
    const markdown = [
      "Here is the change that was applied to the module.",
      "",
      "```typescript",
      "export function accumulateDelta(value: number) {",
      "",
      "  return value + 1;",
      "",
      "}",
    ].join("\n");

    const split = planIncrementalMarkdownSplit(markdown, EAGER);
    expect(split).not.toBeNull();
    expect(split!.tail.source.startsWith("```typescript")).toBe(true);
    expectSplitIsTransparent(markdown);
    expectStreamingIsTransparent(markdown);
  });

  it("keeps a table under construction whole", () => {
    const markdown = [
      "The stages of the pipeline are summarized below.",
      "",
      "| Stage | Expected behavior |",
      "| --- | --- |",
      "| Markdown | Reparse and sanitize |",
      "| Code | Highlight the open fence |",
      "",
      "A closing paragraph after the table.",
    ].join("\n");

    expectSplitIsTransparent(markdown);
    // Every prefix includes the half-built table, where the delimiter row has
    // not arrived and the rows are still plain paragraphs.
    expectStreamingIsTransparent(markdown, 7);
  });

  it("handles a setext heading forming after a boundary", () => {
    const markdown = [
      "An introductory paragraph before the heading.",
      "",
      "A heading written with the setext form",
      "======================================",
      "",
      "A paragraph that follows the setext heading.",
    ].join("\n");

    expectSplitIsTransparent(markdown);
    // Steps of 1 cover the frame where "A heading written..." is still a bare
    // paragraph and the frame right after "=" starts turning it into an h1.
    expectStreamingIsTransparent(markdown, 1);
  });

  it("handles blockquotes and thematic breaks around boundaries", () => {
    const markdown = [
      "A paragraph introducing the quotation below.",
      "",
      "> A blockquote summarizing the tradeoff.",
      "",
      "> A second, separate blockquote.",
      "",
      "---",
      "",
      "A paragraph after the thematic break.",
    ].join("\n");

    expectSplitIsTransparent(markdown);
    expectStreamingIsTransparent(markdown, 3);
  });

  it("splits around lists without ever cutting one in half", () => {
    const markdown = [
      "## Section heading for the streaming corpus",
      "",
      "The assistant explains a change and links to the reducer so the reader can",
      "follow along. This paragraph carries *emphasis* and **strong emphasis**.",
      "",
      "- A bullet describing the first consequence",
      "- A bullet with `inline code` and a trailing clause",
      "- A bullet that runs long enough to wrap in a narrow column",
      "",
      "> A blockquote summarizing the tradeoff being described above.",
      "",
      "### Another heading",
      "",
      "A closing paragraph for the section.",
    ].join("\n");

    expectSplitIsTransparent(markdown);
    expectStreamingIsTransparent(markdown, 11);
  });

  it("keeps task list marker offsets addressed to the whole message", () => {
    const markdown = [
      "A paragraph long enough to create a boundary before the checklist.",
      "",
      "Another paragraph so the checklist is not the first block.",
      "",
      "- [x] Parse the growing transcript",
      "- [ ] Keep the UI responsive",
    ].join("\n");

    const split = planIncrementalMarkdownSplit(markdown, EAGER);
    expect(split).not.toBeNull();
    // The checklist must live entirely in one chunk, and that chunk's offset is
    // what ChatMarkdown adds back to the chunk-relative mdast offset.
    const owning = [...split!.segments, split!.tail].find((chunk) =>
      chunk.source.includes("- [x] Parse"),
    );
    expect(owning).toBeDefined();
    expect(owning!.source).toContain("- [ ] Keep the UI responsive");
    expect(markdown.slice(owning!.offset, owning!.offset + owning!.source.length)).toBe(
      owning!.source,
    );
    expectSplitIsTransparent(markdown);
  });
});

describe("segment stability", () => {
  it("never moves a boundary that was already chosen", () => {
    const pattern = [
      "## Section heading for the streaming corpus",
      "",
      "A paragraph of prose that is long enough to cross the minimum segment",
      "length more than once as the message grows.",
      "",
      "- A bullet describing the first consequence",
      "- A bullet with `inline code` and a trailing clause",
      "",
      "> A blockquote summarizing the tradeoff being described above.",
      "",
    ].join("\n");
    const markdown = pattern.repeat(6);

    let previousCuts: number[] = [];
    for (let end = 1; end <= markdown.length; end += 13) {
      const split = planIncrementalMarkdownSplit(markdown.slice(0, end));
      const cuts = split ? split.segments.map((segment) => segment.offset).slice(1) : [];
      if (split) {
        cuts.push(split.tail.offset);
      }
      if (previousCuts.length > 0 && cuts.length > 0) {
        expect(cuts.slice(0, previousCuts.length), `frame of length ${end}`).toEqual(previousCuts);
      }
      if (cuts.length > 0) {
        previousCuts = cuts;
      }
    }

    expect(previousCuts.length).toBeGreaterThan(1);
  });

  it("stays transparent across a realistic streaming replay", () => {
    const pattern = [
      "## Section heading for the streaming corpus",
      "",
      "The assistant explains a change to `applyThreadDetailEvent` and links to",
      "[the reducer](/repo/src/state/threadReducer.ts) so the reader can follow",
      "along. This paragraph carries *emphasis*, **strong emphasis**, and",
      "~~a retraction~~ so the GFM plugin has real work to do.",
      "",
      "- A bullet describing the first consequence",
      "- A bullet with `inline code` and a trailing clause",
      "- A bullet that runs long enough to wrap in a narrow transcript column",
      "",
      "> A blockquote summarizing the tradeoff being described above.",
      "",
      "| Stage | Behavior |",
      "| --- | --- |",
      "| Markdown | Reparse |",
      "",
    ].join("\n");
    const markdown = pattern.repeat(3);

    for (let end = 1; end <= markdown.length; end += 29) {
      const frame = markdown.slice(0, end);
      expect(renderIncrementally(frame), `frame of length ${end}`).toBe(render(frame));
    }
    expect(renderIncrementally(markdown)).toBe(render(markdown));
  });
});
