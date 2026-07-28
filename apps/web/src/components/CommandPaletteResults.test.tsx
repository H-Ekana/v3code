import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { CommandPaletteResults } from "./CommandPaletteResults";
import type { CommandPaletteActionItem, CommandPaletteGroup } from "./CommandPalette.logic";
import { Command } from "./ui/command";

function actionItem(overrides: Partial<CommandPaletteActionItem> & { value: string }) {
  return {
    kind: "action",
    searchTerms: [],
    title: overrides.value,
    icon: <svg data-testid="row-icon" />,
    run: async () => {},
    ...overrides,
  } satisfies CommandPaletteActionItem;
}

function renderResults(input: {
  groups: ReadonlyArray<CommandPaletteGroup>;
  highlightedItemValue?: string | null;
}) {
  return renderToStaticMarkup(
    <Command items={input.groups.flatMap((group) => group.items.map((item) => item.value))}>
      <CommandPaletteResults
        groups={input.groups}
        highlightedItemValue={input.highlightedItemValue ?? null}
        isActionsOnly={false}
        keybindings={[]}
        onExecuteItem={() => {}}
      />
    </Command>,
  );
}

const GROUP_A: CommandPaletteGroup = {
  value: "actions",
  label: "Actions",
  items: [
    actionItem({ value: "action:new-thread", title: "New thread" }),
    actionItem({ value: "action:settings", title: "Open settings" }),
  ],
};

const GROUP_A_FILTERED: CommandPaletteGroup = {
  value: "actions",
  label: "Actions",
  items: [GROUP_A.items[0] as CommandPaletteActionItem],
};

describe("command palette result rows", () => {
  it("marks the highlighted row with the shared navigation recipe", () => {
    const html = renderResults({
      groups: [GROUP_A],
      highlightedItemValue: "action:settings",
    });

    expect(html).toContain("nav-command-item");
    expect(html).toContain('data-nav-active="true"');
  });

  it("marks exactly one row active", () => {
    const html = renderResults({
      groups: [GROUP_A],
      highlightedItemValue: "action:settings",
    });

    expect(html.match(/data-nav-active="true"/g)).toHaveLength(1);
  });

  it("stops using the generic accent plane for the highlighted row", () => {
    // The palette's selected plane is a restrained violet tint owned by
    // navigation.css, not the global `bg-accent` swatch.
    const html = renderResults({
      groups: [GROUP_A],
      highlightedItemValue: "action:settings",
    });

    expect(html).not.toContain("bg-accent!");
    expect(html).not.toContain("text-accent-foreground!");
  });

  it("wraps the leading icon so it can shift without moving the row", () => {
    const html = renderResults({ groups: [GROUP_A] });

    expect(html).toContain("nav-command-item-icon");
  });

  it("never puts an entrance animation on a row", () => {
    // Rows re-render on every filtering keystroke. Any one-shot animation
    // recipe here would replay per character typed, which is the exact failure
    // this surface must not have.
    const html = renderResults({
      groups: [GROUP_A],
      highlightedItemValue: "action:new-thread",
    });

    expect(html).not.toContain("motion-arrival");
    expect(html).not.toContain("motion-completion");
    expect(html).not.toContain("nav-command-view");
    expect(html).not.toContain("animate-");
  });

  it("renders the same row markup as the result set narrows", () => {
    // Filtering removes rows; it does not re-key or re-decorate the survivors,
    // so the surviving row's markup is byte-identical before and after.
    const wide = renderResults({
      groups: [GROUP_A],
      highlightedItemValue: "action:new-thread",
    });
    const narrow = renderResults({
      groups: [GROUP_A_FILTERED],
      highlightedItemValue: "action:new-thread",
    });

    const survivingRow = (html: string) => {
      const start = html.indexOf('data-nav-active="true"');
      expect(start).toBeGreaterThanOrEqual(0);
      return html.slice(start, start + 200);
    };

    expect(survivingRow(narrow)).toBe(survivingRow(wide));
  });

  it("keeps the item identity that aria-activedescendant is built from", () => {
    // Base UI derives each option's id — and therefore the input's
    // `aria-activedescendant` — from the rendered item. Dropping the item slot
    // or its value would silently break keyboard announcement.
    const html = renderResults({
      groups: [GROUP_A],
      highlightedItemValue: "action:settings",
    });

    expect(html).toContain('data-slot="command-item"');
    expect(html).toContain('role="option"');
    expect(html.match(/role="option"/g)).toHaveLength(2);
  });

  it("keeps disabled rows non-interactive and unhighlighted", () => {
    const html = renderResults({
      groups: [
        {
          value: "actions",
          label: "Actions",
          items: [actionItem({ value: "action:blocked", disabled: true, title: "Blocked" })],
        },
      ],
      highlightedItemValue: "action:blocked",
    });

    expect(html).not.toContain('data-nav-active="true"');
    expect(html).toContain("nav-command-item-icon");
  });
});
