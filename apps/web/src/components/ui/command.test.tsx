import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Command, CommandFooter, CommandInput, commandPaletteViewMotion } from "./command";

describe("command palette view motion", () => {
  it("is keyed by submenu depth alone", () => {
    // Regression guard for the palette's most important constraint. The panel
    // key is what remounts the results and restarts the entrance animation. If
    // anything query-derived ever reaches this key, the palette will animate
    // once per character typed.
    const first = commandPaletteViewMotion({ depth: 0, direction: "none" });
    const second = commandPaletteViewMotion({ depth: 0, direction: "none" });

    expect(first.key).toBe(second.key);
    expect(first.key).toBe("command-view-0");
  });

  it("changes identity only when the submenu stack changes depth", () => {
    const root = commandPaletteViewMotion({ depth: 0, direction: "none" });
    const submenu = commandPaletteViewMotion({ depth: 1, direction: "forward" });

    expect(root.key).not.toBe(submenu.key);
  });

  it("keeps the key stable while the direction is armed and disarmed", () => {
    // Direction is a separate channel precisely so arming a transition does not
    // remount the panel and blow away scroll position or the highlighted row.
    const armed = commandPaletteViewMotion({ depth: 2, direction: "forward" });
    const disarmed = commandPaletteViewMotion({ depth: 2, direction: "none" });

    expect(armed.key).toBe(disarmed.key);
    expect(armed.direction).toBe("forward");
    expect(disarmed.direction).toBe("none");
  });

  it("rests at a direction that produces no animation", () => {
    // `none` is what an unrelated remount — entering browse mode, stepping into
    // a folder — inherits, and `.nav-command-view` maps it to `animation: none`.
    expect(commandPaletteViewMotion({ depth: 0, direction: "none" }).direction).toBe("none");
  });

  it("reports a back direction for popping a submenu", () => {
    expect(commandPaletteViewMotion({ depth: 0, direction: "back" }).direction).toBe("back");
  });

  it("always hangs the transition on the shared navigation recipe", () => {
    expect(commandPaletteViewMotion({ depth: 3, direction: "forward" }).className).toBe(
      "nav-command-view",
    );
  });
});

describe("command compact geometry", () => {
  it("keeps shell selectors on the wrapper and direct-input padding on AutocompleteInput", () => {
    const html = renderToStaticMarkup(
      <Command>
        <CommandInput placeholder="Search commands" />
      </Command>,
    );
    const shellClass = html.match(/class="([^"]*px-\[var\(--command-shell-inset\)[^"]*)"/)?.[1];
    const inputClass = html.match(/class="([^"]*has-focus-visible:ring-0[^"]*)"/)?.[1];

    expect(shellClass).toContain(
      "[&amp;_[data-slot=autocomplete-start-addon]]:ps-[calc(var(--command-shell-inset)+0.0625rem)]",
    );
    expect(shellClass).not.toContain("sm:*:data-[slot=autocomplete-input]");
    expect(inputClass).toContain(
      "sm:*:data-[slot=autocomplete-input]:ps-[calc(var(--command-shell-inset)+1.5rem)]!",
    );
  });

  it("uses the semantic footer inset without changing compact vertical padding", () => {
    const html = renderToStaticMarkup(<CommandFooter>Shortcuts</CommandFooter>);

    expect(html).toContain("px-[var(--command-content-inset)]");
    expect(html).toContain("py-2.5");
  });
});
