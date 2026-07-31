import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  PASTE_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

import {
  type LargePasteDraft,
  normalizeLargePasteText,
  shouldCollapseLargePaste,
} from "~/lib/largePaste";
import { randomUUID } from "~/lib/utils";

interface ComposerLargePasteOptions {
  createLargePasteNode: (paste: LargePasteDraft) => LexicalNode;
  onCreateLargePaste: (paste: LargePasteDraft) => void;
}

export function registerComposerLargePaste(
  editor: LexicalEditor,
  options: ComposerLargePasteOptions,
): () => void {
  return editor.registerCommand(
    PASTE_COMMAND,
    (event) => {
      if (!(event instanceof ClipboardEvent) || event.clipboardData === null) {
        return false;
      }
      if (event.clipboardData.files.length > 0) {
        return false;
      }
      const text = normalizeLargePasteText(event.clipboardData.getData("text/plain"));
      if (!shouldCollapseLargePaste(text)) {
        return false;
      }
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        return false;
      }

      const paste: LargePasteDraft = {
        id: randomUUID(),
        text,
        createdAt: new Date().toISOString(),
      };
      selection.insertNodes([options.createLargePasteNode(paste)]);
      // The draft store must know about the payload before OnChange reports
      // the new placeholder/id order from this same editor update.
      options.onCreateLargePaste(paste);
      event.preventDefault();
      return true;
    },
    COMMAND_PRIORITY_CRITICAL,
  );
}
