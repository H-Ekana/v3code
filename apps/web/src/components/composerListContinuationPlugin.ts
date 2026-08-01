import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from "lexical";

import { collapseExpandedComposerCursor } from "../composer-logic";
import { planListContinuation } from "../composerListContinuation";

export type ComposerListContinuationSelectionApi = {
  /** Collapsed absolute offset using expanded text (matches `$getRoot().getTextContent()`). */
  readExpandedCursor: (fallback: number) => number;
  /** True when the collapsed selection touches an inline chip/token. */
  selectionTouchesInlineToken: (selection: ReturnType<typeof $getSelection>) => boolean;
  /** Set a collapsed-offset range selection (composer offsets). */
  setSelectionRangeAtComposerOffsets: (start: number, end: number) => void;
};

/**
 * Registers Shift+Enter / Enter list-marker continuation on a Lexical editor.
 *
 * Must mutate the editor state directly inside the command listener — listeners
 * already run inside `updateEditorSync`. Nested `editor.update()` is queued and
 * cannot flip the handler's return value in time.
 */
export function registerComposerListContinuation(
  editor: LexicalEditor,
  api: ComposerListContinuationSelectionApi,
): () => void {
  return editor.registerCommand(
    KEY_ENTER_COMMAND,
    (event) => {
      if (!event || event.defaultPrevented) {
        return false;
      }
      if (event.isComposing || event.keyCode === 229) {
        return false;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return false;
      }

      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return false;
      }
      if (api.selectionTouchesInlineToken(selection)) {
        return false;
      }

      const value = $getRoot().getTextContent();
      const expandedCursor = api.readExpandedCursor(value.length);
      const plan = planListContinuation(value, expandedCursor);
      if (plan.kind === "none") {
        return false;
      }

      if (plan.kind === "continue") {
        // Real LineBreakNode (composer model) + next marker text.
        // plan.insertText always starts with "\n".
        selection.insertLineBreak(false);
        const marker = plan.insertText.slice(1);
        if (marker.length > 0) {
          selection.insertText(marker);
        }
      } else {
        const collapsedFrom = collapseExpandedComposerCursor(value, plan.deleteFrom);
        const collapsedTo = collapseExpandedComposerCursor(value, plan.deleteTo);
        if (collapsedFrom >= collapsedTo) {
          return false;
        }
        api.setSelectionRangeAtComposerOffsets(collapsedFrom, collapsedTo);
        const deleteSelection = $getSelection();
        if (!$isRangeSelection(deleteSelection)) {
          return false;
        }
        deleteSelection.removeText();
      }

      event.preventDefault();
      event.stopPropagation();
      return true;
    },
    COMMAND_PRIORITY_NORMAL,
  );
}
