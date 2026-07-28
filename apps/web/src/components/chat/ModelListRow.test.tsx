import { type ProviderDriverKind, type ProviderInstanceId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ModelListRow } from "./ModelListRow";
import { Combobox } from "../ui/combobox";

const MODEL_KEY = "codex:gpt-5";

function renderRow(overrides?: { isConfirming?: boolean; isSelected?: boolean }) {
  return renderToStaticMarkup(
    <Combobox inline open items={[MODEL_KEY]} filteredItems={[MODEL_KEY]} filter={null}>
      <ModelListRow
        index={0}
        model={{ slug: "gpt-5", name: "GPT-5" }}
        instanceId={"codex" as ProviderInstanceId}
        driverKind={"codex" as ProviderDriverKind}
        providerDisplayName="Codex"
        isFavorite={false}
        isSelected={overrides?.isSelected ?? false}
        showProvider
        {...(overrides?.isConfirming === undefined ? {} : { isConfirming: overrides.isConfirming })}
        onToggleFavorite={() => {}}
      />
    </Combobox>,
  );
}

describe("model row selection response", () => {
  it("flags only the row the user just chose", () => {
    expect(renderRow({ isConfirming: true })).toContain('data-nav-confirming="true"');
    expect(renderRow({ isConfirming: false })).not.toContain("data-nav-confirming");
    expect(renderRow()).not.toContain("data-nav-confirming");
  });

  it("hangs the response on the shared navigation recipe", () => {
    expect(renderRow()).toContain("nav-model-row");
  });

  it("keeps the selected row's glow inside the ordinary-effect budget", () => {
    // Two slices meet on this line. The navigation slice must not *amplify* the
    // selected treatment (plan item 15: "preserve existing provider accents
    // without increasing the selected-row glow"); the visual-cleanup slice then
    // brought it from 10/12/14px down into the plan's 3–4px ordinary budget.
    //
    // Assert the budget rather than an exact radius. Pinning the literal is what
    // made this test break when the glow was legitimately tightened — a further
    // reduction should stay legal, and only re-inflation should fail.
    const selected = renderRow({ isSelected: true });

    const radii = (selected.match(/shadow-\[[^\]]+\]/g) ?? []).flatMap((shadow) =>
      [...shadow.matchAll(/(\d+)px/g)].map((match) => Number(match[1])),
    );

    expect(radii.length).toBeGreaterThan(0);
    expect(Math.max(...radii)).toBeLessThanOrEqual(4);
  });

  it("keeps the row's combobox identity intact while confirming", () => {
    // The confirmation must not disturb the value the combobox reports, which
    // is what drives selection and active-descendant state.
    const confirming = renderRow({ isConfirming: true });

    expect(confirming).toContain('role="option"');
    expect(confirming).toContain('data-slot="combobox-item"');
  });

  it("does not scale or bounce a dense list row", () => {
    const html = renderRow({ isConfirming: true });

    expect(html).not.toContain("hover:scale");
    expect(html).not.toContain("animate-bounce");
  });
});
