/**
 * Streaming assistant transcripts re-parse the entire accumulated message on
 * every delta, so rendering a growing message costs O(n^2). This module finds
 * block boundaries at which the accumulated text can be cut into a stable
 * prefix (rendered through memoized components) plus a short, still-growing
 * tail, turning that into roughly O(n).
 *
 * Markdown is context sensitive, so every rule here is deliberately
 * conservative: a missed split is invisible, a wrong split is a rendering bug.
 * The planner refuses to split (returns `null`, meaning "render the whole
 * string") whenever the text contains a construct whose meaning can reach
 * backwards across a block boundary.
 *
 * ## Why a blank-line cut is safe at all
 *
 * In CommonMark a blank line terminates every leaf block: paragraphs, setext
 * headings (the underline must directly follow the paragraph), ATX headings,
 * thematic breaks, and — in GFM — tables (the delimiter row must directly
 * follow the header row, so a table can never re-form across a blank line).
 * The constructs that *do* survive a blank line are handled explicitly:
 *
 * - Fenced code: tracked with a fence state machine; blank lines inside a fence
 *   are never candidates, so an open fence simply pushes the cut back before it.
 * - Lists: a list continues across a blank line, and doing so turns it loose.
 *   Refused via {@link isSplitSafeBoundaryLine} on *both* sides of the blank run.
 * - Indented code: consecutive indented chunks separated by blank lines are one
 *   block. Also refused by {@link isSplitSafeBoundaryLine} (leading whitespace).
 * - HTML blocks of type 1-5 (`<pre>`, `<!-- -->`, `<?`, `<!`, `<![CDATA[`) end
 *   only at their own close condition, not at a blank line. Refused globally
 *   together with all other raw HTML, because rehype-raw re-serializes and
 *   re-parses the *whole* tree through parse5 and an unbalanced tag in the
 *   prefix changes how the rest of the document nests.
 * - Link reference definitions and GFM footnote definitions resolve backwards:
 *   a definition arriving later changes how earlier text renders. Refused
 *   globally.
 *
 * Because the hazard scan runs over the *current* full text on every delta,
 * correctness never depends on a hazard being predicted early: the moment one
 * appears, the planner refuses and the caller renders the whole string again.
 */

/** Below this size a full re-parse is cheap enough that splitting is noise. */
const DEFAULT_MIN_TEXT_LENGTH = 1_500;
/**
 * Minimum growth before another segment is frozen. Keeps the segment count
 * bounded and, more importantly, makes the cut sequence a monotone function of
 * the text: a greedy left-to-right scan with a fixed minimum never moves a cut
 * that was already chosen, which is what lets the memoized prefix stay stable.
 */
const DEFAULT_MIN_SEGMENT_LENGTH = 512;

const BLANK_LINE_PATTERN = /^[ \t]*$/;
const FENCE_OPEN_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
/** Any raw HTML tag, comment, declaration or processing instruction. */
const RAW_HTML_PATTERN = /<[!/?a-zA-Z]/;
/** `[label]: destination`, including indented / block-quoted definitions. */
const DEFINITION_PATTERN = /^[ \t>]*\[[^\]]*\]:/;
/** Any GFM footnote reference or definition. */
const FOOTNOTE_PATTERN = /\[\^/;
const INDENTED_PATTERN = /^[ \t]/;
const BULLET_MARKER_PATTERN = /^[-+*](?:[ \t]|$)/;
const ORDERED_MARKER_PATTERN = /^\d{1,9}[.)](?:[ \t]|$)/;

export interface IncrementalMarkdownChunk {
  /** Exact slice of the original text. */
  readonly source: string;
  /** Start offset of `source` inside the original text. */
  readonly offset: number;
}

export interface IncrementalMarkdownSplit {
  /**
   * Frozen leading chunks, in order. `segments.map((s) => s.source).join("") +
   * tail.source` is exactly the input text.
   */
  readonly segments: readonly IncrementalMarkdownChunk[];
  /** The still-growing remainder. */
  readonly tail: IncrementalMarkdownChunk;
}

export type IncrementalMarkdownRefusal =
  | "too-short"
  | "raw-html"
  | "link-reference-definition"
  | "footnote"
  | "no-safe-boundary";

export interface IncrementalMarkdownPlan {
  readonly split: IncrementalMarkdownSplit | null;
  readonly refusal: IncrementalMarkdownRefusal | null;
}

export interface IncrementalMarkdownOptions {
  readonly minTextLength?: number;
  readonly minSegmentLength?: number;
}

/**
 * A blank line may only be cut at when the last line before it and the first
 * line after it are both plain, column-0 block starts.
 *
 * Leading whitespace is refused because it can be list-item continuation or
 * indented code, both of which survive a blank line. A list marker is refused
 * because a marker on either side can join the blocks into a single loose list
 * — including the case where the line before the blank is a *lazy*
 * continuation of a list item and therefore looks like an ordinary paragraph.
 */
export function isSplitSafeBoundaryLine(line: string): boolean {
  return (
    !INDENTED_PATTERN.test(line) &&
    !BULLET_MARKER_PATTERN.test(line) &&
    !ORDERED_MARKER_PATTERN.test(line)
  );
}

function hazardForLine(line: string): IncrementalMarkdownRefusal | null {
  if (RAW_HTML_PATTERN.test(line)) return "raw-html";
  if (FOOTNOTE_PATTERN.test(line)) return "footnote";
  if (DEFINITION_PATTERN.test(line)) return "link-reference-definition";
  return null;
}

interface OpenFence {
  readonly marker: string;
  readonly length: number;
}

function openedFence(line: string): OpenFence | null {
  const match = FENCE_OPEN_PATTERN.exec(line);
  if (!match?.[1]) return null;
  const marker = match[1];
  const info = (match[2] ?? "").trim();
  // A backtick fence's info string may not itself contain a backtick.
  if (marker[0] === "`" && info.includes("`")) return null;
  return { marker: marker[0] as string, length: marker.length };
}

function closesFence(line: string, fence: OpenFence): boolean {
  const match = FENCE_CLOSE_PATTERN.exec(line);
  if (!match?.[1]) return false;
  return match[1][0] === fence.marker && match[1].length >= fence.length;
}

/**
 * Same as {@link planIncrementalMarkdownSplit}, but also reports *why* a split
 * was refused. Exposed for tests, which assert the fallback engaged rather than
 * asserting a particular (wrong) split.
 */
export function explainIncrementalMarkdownSplit(
  text: string,
  options?: IncrementalMarkdownOptions,
): IncrementalMarkdownPlan {
  const minTextLength = options?.minTextLength ?? DEFAULT_MIN_TEXT_LENGTH;
  const minSegmentLength = options?.minSegmentLength ?? DEFAULT_MIN_SEGMENT_LENGTH;
  if (text.length < minTextLength) {
    return { split: null, refusal: "too-short" };
  }

  const lines = text.split("\n");
  // Every element except the last is newline terminated, so the last element is
  // the still-incomplete line. Its content can still change, so it never
  // participates in a boundary decision — only in the hazard scan.
  const lastIndex = lines.length - 1;

  const cuts: number[] = [];
  let offset = 0;
  let fence: OpenFence | null = null;
  /** Last non-blank line seen outside a fence, or null when unusable. */
  let previousNonBlankLine: string | null = null;
  /** Offset of the line that follows the current run of blank lines. */
  let blankRunEnd: number | null = null;
  let lastCut = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineStart = offset;
    offset += line.length + 1;

    if (fence) {
      // Content inside a fence is inert, but it can hide blank lines and
      // hazard-shaped text, so skip both checks and drop any pending blank run.
      if (index < lastIndex && closesFence(line, fence)) {
        fence = null;
        previousNonBlankLine = line;
      } else {
        previousNonBlankLine = null;
      }
      blankRunEnd = null;
      continue;
    }

    const hazard = hazardForLine(line);
    if (hazard) {
      return { split: null, refusal: hazard };
    }

    if (BLANK_LINE_PATTERN.test(line)) {
      if (previousNonBlankLine !== null) {
        blankRunEnd = offset;
      }
      continue;
    }

    const pendingBlankRunEnd = blankRunEnd;
    const lineBeforeBlankRun = previousNonBlankLine;
    blankRunEnd = null;
    previousNonBlankLine = line;

    if (index < lastIndex) {
      const opened = openedFence(line);
      if (opened) {
        fence = opened;
      }
    }

    if (
      pendingBlankRunEnd === null ||
      lineBeforeBlankRun === null ||
      // The line after the blank run must already be complete: a trailing "1"
      // is a safe paragraph start but a trailing "1." is an ordered-list
      // marker, so committing before the newline arrives could freeze a cut
      // that a later character makes unsafe.
      index === lastIndex ||
      pendingBlankRunEnd !== lineStart ||
      !isSplitSafeBoundaryLine(lineBeforeBlankRun) ||
      !isSplitSafeBoundaryLine(line)
    ) {
      continue;
    }

    if (pendingBlankRunEnd - lastCut < minSegmentLength) continue;
    cuts.push(pendingBlankRunEnd);
    lastCut = pendingBlankRunEnd;
  }

  if (cuts.length === 0) {
    return { split: null, refusal: "no-safe-boundary" };
  }

  const segments: IncrementalMarkdownChunk[] = [];
  let start = 0;
  for (const cut of cuts) {
    segments.push({ source: text.slice(start, cut), offset: start });
    start = cut;
  }

  return {
    split: {
      segments,
      tail: { source: text.slice(start), offset: start },
    },
    refusal: null,
  };
}

/**
 * Plans an incremental render of `text`, or returns `null` when the whole
 * string must be rendered in one piece.
 */
export function planIncrementalMarkdownSplit(
  text: string,
  options?: IncrementalMarkdownOptions,
): IncrementalMarkdownSplit | null {
  return explainIncrementalMarkdownSplit(text, options).split;
}
