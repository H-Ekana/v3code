// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { Menu, MenuTrigger } from "../ui/menu";
import { Popover, PopoverTrigger } from "../ui/popover";
import { Select } from "../ui/select";
import {
  COMPOSER_CONTROL_MIN_PRESS_MS,
  ComposerControl,
  ComposerSelectControl,
} from "./ComposerControl";

let container: HTMLDivElement;
let root: Root;

const control = (name: string): HTMLButtonElement => {
  const button = container.querySelector<HTMLButtonElement>(`#${name}`);
  if (!button) throw new Error(`${name} control not rendered`);
  return button;
};

const dispatchPointer = (
  target: EventTarget,
  type: "pointerdown" | "pointerup" | "pointercancel",
  pointerId: number,
) => {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, button: 0, isPrimary: true, pointerId }),
  );
};

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root.render(
      createElement(
        "div",
        null,
        createElement(ComposerControl, { id: "build" }, "Build"),
        createElement(
          Popover,
          null,
          createElement(
            PopoverTrigger,
            { render: createElement(ComposerControl, { id: "model" }) },
            "Model",
          ),
        ),
        createElement(
          Menu,
          null,
          createElement(
            MenuTrigger,
            { render: createElement(ComposerControl, { id: "reasoning" }) },
            "High",
          ),
        ),
        createElement(
          Select,
          { defaultValue: "auto" },
          createElement(ComposerSelectControl, { id: "auto" }, "Auto"),
        ),
      ),
    );
  });
});

afterEach(() => {
  act(() => {
    for (let pointerId = 1; pointerId <= 10; pointerId += 1) {
      dispatchPointer(window, "pointercancel", pointerId);
    }
    vi.runAllTimers();
  });
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("composer control press feedback", () => {
  it("starts on pointerdown through every composer trigger primitive", () => {
    ["build", "model", "reasoning", "auto"].forEach((name, pointerId) => {
      act(() => dispatchPointer(control(name), "pointerdown", pointerId + 1));
      expect(control(name).getAttribute("data-composer-pressing")).toBe("true");
    });
  });

  it("keeps a quick press visible for the minimum inward beat", () => {
    const button = control("auto");
    act(() => dispatchPointer(button, "pointerdown", 1));
    act(() => dispatchPointer(window, "pointerup", 1));

    expect(button.getAttribute("data-composer-pressing")).toBe("true");
    act(() => vi.advanceTimersByTime(COMPOSER_CONTROL_MIN_PRESS_MS - 1));
    expect(button.getAttribute("data-composer-pressing")).toBe("true");
    act(() => vi.advanceTimersByTime(1));
    expect(button.getAttribute("data-composer-pressing")).toBeNull();
  });

  it("releases from pointercancel outside the trigger without getting stuck", () => {
    const button = control("reasoning");
    act(() => dispatchPointer(button, "pointerdown", 7));
    act(() => vi.advanceTimersByTime(COMPOSER_CONTROL_MIN_PRESS_MS));
    act(() => dispatchPointer(window, "pointercancel", 7));

    expect(button.getAttribute("data-composer-pressing")).toBeNull();
  });

  it("preserves consumer pointerdown handlers", () => {
    const onPointerDown = vi.fn();
    act(() => {
      root.render(createElement(ComposerControl, { id: "custom", onPointerDown }, "Custom"));
    });

    act(() => dispatchPointer(control("custom"), "pointerdown", 9));
    expect(onPointerDown).toHaveBeenCalledTimes(1);
  });
});
