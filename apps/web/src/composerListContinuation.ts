/**
 * Markdown-style list continuation for the plain-text composer.
 * Mirrors the core Enter behavior of editors like Markdown All in One / Obsidian:
 * continue markers on newline, exit when the current item is empty.
 */

export type ListContinuationPlan =
  | {
      readonly kind: "continue";
      /** Text to insert at the cursor, always starting with `\n`. */
      readonly insertText: string;
    }
  | {
      readonly kind: "exit";
      /** Absolute start offset of the list marker prefix on the current line. */
      readonly deleteFrom: number;
      /** Absolute end offset of the range to delete (typically the cursor). */
      readonly deleteTo: number;
    }
  | { readonly kind: "none" };

const ORDERED_LIST_PREFIX =
  /^(?<indent>[ \t]*)(?<number>\d{1,9})(?<delimiter>[.)])(?<spaces>[ \t]+)(?<checkbox>\[[ xX]\][ \t]+)?$/;
const BULLET_LIST_PREFIX =
  /^(?<indent>[ \t]*)(?<bullet>[-+*])(?<spaces>[ \t]+)(?<checkbox>\[[ xX]\][ \t]+)?$/;

const ORDERED_LIST_BEFORE_CURSOR =
  /^(?<indent>[ \t]*)(?<number>\d{1,9})(?<delimiter>[.)])(?<spaces>[ \t]+)(?<checkbox>\[[ xX]\][ \t]+)?/;
const BULLET_LIST_BEFORE_CURSOR =
  /^(?<indent>[ \t]*)(?<bullet>[-+*])(?<spaces>[ \t]+)(?<checkbox>\[[ xX]\][ \t]+)?/;

const FENCE_OPEN_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

function lineBoundsAtOffset(text: string, offset: number): { start: number; end: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const start = clamped === 0 ? 0 : text.lastIndexOf("\n", clamped - 1) + 1;
  const nextBreak = text.indexOf("\n", clamped);
  const end = nextBreak === -1 ? text.length : nextBreak;
  return { start, end };
}

/**
 * True when `offset` sits inside an open fenced code block (``` / ~~~).
 * Scans only the text before the offset.
 */
export function isInsideFencedCodeBlock(text: string, offset: number): boolean {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const prefix = text.slice(0, clamped);
  const lines = prefix.split("\n");
  // Drop the incomplete current line — fence state is determined by completed lines only.
  lines.pop();

  let openMarker: string | null = null;
  let openLength = 0;

  for (const line of lines) {
    if (openMarker === null) {
      const open = FENCE_OPEN_PATTERN.exec(line);
      if (open) {
        openMarker = open[1]![0]!;
        openLength = open[1]!.length;
      }
      continue;
    }

    const close = FENCE_CLOSE_PATTERN.exec(line);
    if (close && close[1]![0] === openMarker && close[1]!.length >= openLength) {
      openMarker = null;
      openLength = 0;
    }
  }

  return openMarker !== null;
}

function emptyCheckboxPrefix(checkbox: string | undefined): string {
  if (!checkbox) return "";
  // Preserve spacing after the box; always reopen unchecked.
  return checkbox.replace(/\[[xX]\]/, "[ ]");
}

/**
 * Plan what Enter/Shift+Enter should do for markdown list markers on the current line.
 *
 * @param text Full composer plain text (`\n` line breaks).
 * @param cursor Absolute caret offset (collapsed).
 */
export function planListContinuation(text: string, cursor: number): ListContinuationPlan {
  if (cursor < 0 || cursor > text.length) {
    return { kind: "none" };
  }

  if (isInsideFencedCodeBlock(text, cursor)) {
    return { kind: "none" };
  }

  const { start: lineStart, end: lineEnd } = lineBoundsAtOffset(text, cursor);
  const textBeforeCursor = text.slice(lineStart, cursor);
  const textAfterCursor = text.slice(cursor, lineEnd);

  // Empty list item → strip the marker instead of continuing.
  if (textAfterCursor.trim().length === 0) {
    const emptyOrdered = ORDERED_LIST_PREFIX.exec(textBeforeCursor);
    if (emptyOrdered?.groups) {
      return {
        kind: "exit",
        deleteFrom: lineStart,
        deleteTo: cursor,
      };
    }
    const emptyBullet = BULLET_LIST_PREFIX.exec(textBeforeCursor);
    if (emptyBullet?.groups) {
      return {
        kind: "exit",
        deleteFrom: lineStart,
        deleteTo: cursor,
      };
    }
  }

  const ordered = ORDERED_LIST_BEFORE_CURSOR.exec(textBeforeCursor);
  if (ordered?.groups && ordered.index === 0 && ordered[0].length > 0) {
    // Only continue when the match is a real list prefix at the start of the line
    // and there is content or we already handled empty above.
    const indent = ordered.groups.indent ?? "";
    const number = ordered.groups.number ?? "1";
    const delimiter = ordered.groups.delimiter ?? ".";
    const spaces = ordered.groups.spaces ?? " ";
    const checkbox = emptyCheckboxPrefix(ordered.groups.checkbox);
    const nextNumber = String(Number(number) + 1);
    // Keep at least one space; pad so text still roughly aligns when digit count grows.
    const previousMarkerWidth = number.length + delimiter.length + spaces.length;
    const nextSpaces = " ".repeat(
      Math.max(1, previousMarkerWidth - (nextNumber.length + delimiter.length)),
    );
    return {
      kind: "continue",
      insertText: `\n${indent}${nextNumber}${delimiter}${nextSpaces}${checkbox}`,
    };
  }

  const bullet = BULLET_LIST_BEFORE_CURSOR.exec(textBeforeCursor);
  if (bullet?.groups && bullet.index === 0 && bullet[0].length > 0) {
    const indent = bullet.groups.indent ?? "";
    const marker = bullet.groups.bullet ?? "-";
    const spaces = bullet.groups.spaces ?? " ";
    const checkbox = emptyCheckboxPrefix(bullet.groups.checkbox);
    return {
      kind: "continue",
      insertText: `\n${indent}${marker}${spaces}${checkbox}`,
    };
  }

  return { kind: "none" };
}
