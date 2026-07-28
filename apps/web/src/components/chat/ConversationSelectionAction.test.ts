// @vitest-environment happy-dom

import { describe, expect, it } from "vite-plus/test";

import {
  CONVERSATION_SELECTION_SETTLE_MS,
  clampSelectionActionPosition,
  conversationSelectionChangeAction,
  resolveScopedConversationSelection,
} from "./ConversationSelectionAction";

describe("clampSelectionActionPosition", () => {
  it("places a left-side selection outside the left edge of the conversation column", () => {
    expect(
      clampSelectionActionPosition({
        selectionRect: { left: 240, top: 160, width: 120, height: 40 },
        columnRect: { left: 200, right: 800 },
        conversationRect: { left: 0, right: 1000 },
        cursorX: 260,
        popupWidth: 120,
        popupHeight: 32,
        viewportWidth: 1000,
        viewportHeight: 600,
      }),
    ).toEqual({ x: 132, y: 160 });
  });

  it("places a right-side selection outside the right edge of the conversation column", () => {
    expect(
      clampSelectionActionPosition({
        selectionRect: { left: 680, top: 220, width: 80, height: 40 },
        columnRect: { left: 200, right: 800 },
        conversationRect: { left: 0, right: 1000 },
        cursorX: 740,
        popupWidth: 120,
        popupHeight: 32,
        viewportWidth: 1000,
        viewportHeight: 600,
      }),
    ).toEqual({ x: 868, y: 220 });
  });

  it("uses the pointer endpoint rather than the selection midpoint to choose a side", () => {
    expect(
      clampSelectionActionPosition({
        selectionRect: { left: 300, top: 180, width: 400, height: 40 },
        columnRect: { left: 200, right: 800 },
        conversationRect: { left: 0, right: 1000 },
        cursorX: 230,
        popupWidth: 120,
        popupHeight: 32,
        viewportWidth: 1000,
        viewportHeight: 600,
      }),
    ).toEqual({ x: 132, y: 180 });
  });

  it("places the action above the selection when neither side of a squeezed column fits", () => {
    expect(
      clampSelectionActionPosition({
        selectionRect: { left: 320, top: 160, width: 160, height: 60 },
        columnRect: { left: 200, right: 800 },
        conversationRect: { left: 180, right: 820 },
        cursorX: 450,
        popupWidth: 120,
        popupHeight: 32,
        viewportWidth: 1000,
        viewportHeight: 600,
      }),
    ).toEqual({ x: 450, y: 120 });
  });
});

describe("conversationSelectionChangeAction", () => {
  it("waits until an active pointer selection has stopped moving", () => {
    expect(
      conversationSelectionChangeAction({
        hasSelection: true,
        isPointerSelecting: true,
      }),
    ).toBe("wait");
  });

  it("schedules the action only after a settled selection and hides for no selection", () => {
    expect(CONVERSATION_SELECTION_SETTLE_MS).toBe(90);
    expect(
      conversationSelectionChangeAction({
        hasSelection: true,
        isPointerSelecting: false,
      }),
    ).toBe("schedule");
    expect(
      conversationSelectionChangeAction({
        hasSelection: false,
        isPointerSelecting: false,
      }),
    ).toBe("hide");
  });
});

describe("resolveScopedConversationSelection", () => {
  it("keeps a single-message selection when the drag endpoint lands outside the text column", () => {
    const root = document.createElement("div");
    const outside = document.createElement("div");
    outside.textContent = "Outside the message";
    const scope = document.createElement("div");
    scope.dataset.conversationSelectableText = "";
    scope.dataset.messageId = "message-1";
    scope.dataset.messageRole = "assistant";
    scope.textContent = "Selected message text";
    root.append(outside, scope);
    document.body.append(root);

    const range = document.createRange();
    range.setStart(root, 0);
    range.setEnd(scope.firstChild!, scope.firstChild!.textContent!.length);
    const result = resolveScopedConversationSelection(root, {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
    });

    expect(result?.scope).toBe(scope);
    expect(result?.range.toString()).toBe("Selected message text");
    root.remove();
  });

  it("still rejects a selection spanning more than one message", () => {
    const root = document.createElement("div");
    const firstScope = document.createElement("div");
    firstScope.dataset.conversationSelectableText = "";
    firstScope.textContent = "First message";
    const secondScope = document.createElement("div");
    secondScope.dataset.conversationSelectableText = "";
    secondScope.textContent = "Second message";
    root.append(firstScope, secondScope);
    document.body.append(root);

    const range = document.createRange();
    range.setStart(firstScope.firstChild!, 0);
    range.setEnd(secondScope.firstChild!, secondScope.firstChild!.textContent!.length);

    expect(
      resolveScopedConversationSelection(root, {
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt: () => range,
      }),
    ).toBeNull();
    root.remove();
  });
});
