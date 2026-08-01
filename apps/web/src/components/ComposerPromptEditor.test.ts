import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_EDITOR,
  createEditor,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  type LexicalNode,
} from "lexical";

import { registerComposerInlineTokenPaste } from "./composerInlineTokenPaste";
import { registerComposerLargePaste } from "./composerLargePaste";
import { registerComposerListContinuation } from "./composerListContinuationPlugin";
import { LARGE_PASTE_CHAR_THRESHOLD, type LargePasteDraft } from "../lib/largePaste";

class TestClipboardEvent extends Event {
  readonly clipboardData: DataTransfer;

  constructor(text: string) {
    super("paste", { cancelable: true });
    this.clipboardData = {
      files: [],
      getData: (type: string) => (type === "text/plain" ? text : ""),
    } as unknown as DataTransfer;
  }
}

class TestKeyboardEvent extends Event {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly isComposing: boolean;
  readonly keyCode: number;

  constructor(
    key: string,
    options: {
      shiftKey?: boolean;
      metaKey?: boolean;
      ctrlKey?: boolean;
      altKey?: boolean;
      isComposing?: boolean;
      keyCode?: number;
    } = {},
  ) {
    super("keydown", { cancelable: true, bubbles: true });
    this.key = key;
    this.shiftKey = options.shiftKey ?? false;
    this.metaKey = options.metaKey ?? false;
    this.ctrlKey = options.ctrlKey ?? false;
    this.altKey = options.altKey ?? false;
    this.isComposing = options.isComposing ?? false;
    this.keyCode = options.keyCode ?? 0;
  }
}

describe("registerComposerInlineTokenPaste", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("handles a copied mention without also running the plain-text paste fallback", () => {
    vi.stubGlobal("ClipboardEvent", TestClipboardEvent);
    const editor = createEditor();
    const mention = "[improve-deploy-error-logging.md](.changeset/improve-deploy-error-logging.md)";
    const plainTextFallback = vi.fn(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      selection.insertText(mention);
      return true;
    });

    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        $getRoot().append(paragraph);
        paragraph.selectEnd();
      },
      { discrete: true },
    );
    registerComposerInlineTokenPaste(editor, {
      createMentionNode: (path) => $createTextNode(`<mention:${path}>`),
      getExpandedAbsoluteOffsetForPoint: () => 0,
    });
    editor.registerCommand(PASTE_COMMAND, plainTextFallback, COMMAND_PRIORITY_EDITOR);

    const event = new TestClipboardEvent(mention);
    let handled = false;
    editor.update(
      () => {
        handled = editor.dispatchCommand(PASTE_COMMAND, event as ClipboardEvent);
      },
      { discrete: true },
    );

    expect(handled).toBe(true);
    expect(plainTextFallback).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(
      "<mention:.changeset/improve-deploy-error-logging.md> ",
    );
  });

  it.each([
    "yarn expo install @expo/ui",
    "npm install @jane/foo.js",
    "import '@scope/pkg/sub/path'",
  ])("leaves scoped package command %s to the plain-text paste fallback", (command) => {
    vi.stubGlobal("ClipboardEvent", TestClipboardEvent);
    const editor = createEditor();
    const plainTextFallback = vi.fn((event: ClipboardEvent) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      selection.insertText(event.clipboardData?.getData("text/plain") ?? "");
      return true;
    });

    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        $getRoot().append(paragraph);
        paragraph.selectEnd();
      },
      { discrete: true },
    );
    registerComposerInlineTokenPaste(editor, {
      createMentionNode: (path) => $createTextNode(`<mention:${path}>`),
      getExpandedAbsoluteOffsetForPoint: () => 0,
    });
    editor.registerCommand(PASTE_COMMAND, plainTextFallback, COMMAND_PRIORITY_EDITOR);

    const event = new TestClipboardEvent(command);
    let handled = false;
    editor.update(
      () => {
        handled = editor.dispatchCommand(PASTE_COMMAND, event as ClipboardEvent);
      },
      { discrete: true },
    );

    expect(handled).toBe(true);
    expect(plainTextFallback).toHaveBeenCalledOnce();
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(command);
  });

  it("pastes a canonical scoped folder link as a mention", () => {
    vi.stubGlobal("ClipboardEvent", TestClipboardEvent);
    const editor = createEditor();
    const mention = "[sub](@scope/pkg/sub)";
    const plainTextFallback = vi.fn(() => true);

    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        $getRoot().append(paragraph);
        paragraph.selectEnd();
      },
      { discrete: true },
    );
    registerComposerInlineTokenPaste(editor, {
      createMentionNode: (path) => $createTextNode(`<mention:${path}>`),
      getExpandedAbsoluteOffsetForPoint: () => 0,
    });
    editor.registerCommand(PASTE_COMMAND, plainTextFallback, COMMAND_PRIORITY_EDITOR);

    const event = new TestClipboardEvent(mention);
    let handled = false;
    editor.update(
      () => {
        handled = editor.dispatchCommand(PASTE_COMMAND, event as ClipboardEvent);
      },
      { discrete: true },
    );

    expect(handled).toBe(true);
    expect(plainTextFallback).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(
      "<mention:@scope/pkg/sub> ",
    );
  });
});

describe("registerComposerLargePaste", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces a paste above the threshold before the plain-text fallback runs", () => {
    vi.stubGlobal("ClipboardEvent", TestClipboardEvent);
    const editor = createEditor();
    const createLargePasteNode = vi.fn((_paste: LargePasteDraft) =>
      $createTextNode("<large-paste>"),
    );
    const plainTextFallback = vi.fn(() => true);

    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        $getRoot().append(paragraph);
        paragraph.selectEnd();
      },
      { discrete: true },
    );
    registerComposerLargePaste(editor, {
      createLargePasteNode,
    });
    editor.registerCommand(PASTE_COMMAND, plainTextFallback, COMMAND_PRIORITY_EDITOR);

    const text = "x".repeat(LARGE_PASTE_CHAR_THRESHOLD + 1);
    const event = new TestClipboardEvent(text);
    editor.update(
      () => {
        editor.dispatchCommand(PASTE_COMMAND, event as ClipboardEvent);
      },
      { discrete: true },
    );

    expect(plainTextFallback).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(createLargePasteNode).toHaveBeenCalledOnce();
    expect(createLargePasteNode.mock.calls[0]?.[0]).toMatchObject({ text });
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("<large-paste>");
  });

  it("leaves a paste exactly at the threshold editable inline", () => {
    vi.stubGlobal("ClipboardEvent", TestClipboardEvent);
    const editor = createEditor();
    const plainTextFallback = vi.fn(() => true);

    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        $getRoot().append(paragraph);
        paragraph.selectEnd();
      },
      { discrete: true },
    );
    registerComposerLargePaste(editor, {
      createLargePasteNode: () => $createTextNode("<large-paste>"),
    });
    editor.registerCommand(PASTE_COMMAND, plainTextFallback, COMMAND_PRIORITY_EDITOR);

    const event = new TestClipboardEvent("x".repeat(LARGE_PASTE_CHAR_THRESHOLD));
    editor.update(
      () => {
        editor.dispatchCommand(PASTE_COMMAND, event as ClipboardEvent);
      },
      { discrete: true },
    );

    expect(plainTextFallback).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("registerComposerListContinuation", () => {
  function findPointAtOffset(
    node: LexicalNode,
    remaining: { value: number },
  ): { key: string; offset: number; type: "text" | "element" } | null {
    if ($isTextNode(node)) {
      const size = node.getTextContentSize();
      if (remaining.value <= size) {
        return { key: node.getKey(), offset: remaining.value, type: "text" };
      }
      remaining.value -= size;
      return null;
    }
    if ($isLineBreakNode(node)) {
      if (remaining.value === 0) {
        const parent = node.getParent();
        if (!parent) return null;
        return { key: parent.getKey(), offset: node.getIndexWithinParent(), type: "element" };
      }
      if (remaining.value === 1) {
        const parent = node.getParent();
        if (!parent) return null;
        return { key: parent.getKey(), offset: node.getIndexWithinParent() + 1, type: "element" };
      }
      remaining.value -= 1;
      return null;
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        const point = findPointAtOffset(child, remaining);
        if (point) return point;
      }
    }
    return null;
  }

  function setRangeAtOffsets(start: number, end: number): void {
    const root = $getRoot();
    const anchor = findPointAtOffset(root, { value: start }) ?? {
      key: root.getKey(),
      offset: root.getChildrenSize(),
      type: "element" as const,
    };
    const focus = findPointAtOffset(root, { value: end }) ?? {
      key: root.getKey(),
      offset: root.getChildrenSize(),
      type: "element" as const,
    };
    const selection = $createRangeSelection();
    selection.anchor.set(anchor.key, anchor.offset, anchor.type);
    selection.focus.set(focus.key, focus.offset, focus.type);
    $setSelection(selection);
  }

  function registerTestListContinuation(editor: ReturnType<typeof createEditor>) {
    return registerComposerListContinuation(editor, {
      // Fixtures select the end of the document (no inline chips).
      readExpandedCursor: (fallback) => $getRoot().getTextContent().length || fallback,
      selectionTouchesInlineToken: () => false,
      setSelectionRangeAtComposerOffsets: setRangeAtOffsets,
    });
  }

  it("continues an ordered list on Enter without nesting editor.update", () => {
    const editor = createEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode("1. first"));
        $getRoot().append(paragraph);
        paragraph.selectEnd();
      },
      { discrete: true },
    );
    registerTestListContinuation(editor);

    const event = new TestKeyboardEvent("Enter", { shiftKey: true });
    let handled = false;
    // Dispatch inside an update — mirrors Lexical's real command path
    // (triggerCommandListeners → updateEditorSync). Nested editor.update
    // would queue and fail to claim the key; direct mutation must work.
    editor.update(
      () => {
        handled = editor.dispatchCommand(KEY_ENTER_COMMAND, event as unknown as KeyboardEvent);
      },
      { discrete: true },
    );

    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("1. first\n2. ");
  });

  it("exits an empty list item instead of continuing", () => {
    const editor = createEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode("1. first"));
        paragraph.append($createLineBreakNode());
        paragraph.append($createTextNode("2. "));
        $getRoot().append(paragraph);
        paragraph.selectEnd();
      },
      { discrete: true },
    );
    registerTestListContinuation(editor);

    const event = new TestKeyboardEvent("Enter", { shiftKey: true });
    let handled = false;
    editor.update(
      () => {
        handled = editor.dispatchCommand(KEY_ENTER_COMMAND, event as unknown as KeyboardEvent);
      },
      { discrete: true },
    );

    expect(handled).toBe(true);
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("1. first\n");
  });

  it("does not claim Enter on plain prose", () => {
    const editor = createEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode("hello"));
        $getRoot().append(paragraph);
        paragraph.selectEnd();
      },
      { discrete: true },
    );
    registerTestListContinuation(editor);

    const event = new TestKeyboardEvent("Enter", { shiftKey: true });
    let handled = false;
    editor.update(
      () => {
        handled = editor.dispatchCommand(KEY_ENTER_COMMAND, event as unknown as KeyboardEvent);
      },
      { discrete: true },
    );

    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("hello");
  });
});
