import { ProviderDriverKind } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ProviderInstanceIdField } from "./AddProviderInstanceDialog";

describe("ProviderInstanceIdField", () => {
  it("associates blocking validation errors and announces them urgently", () => {
    const html = renderToStaticMarkup(
      <ProviderInstanceIdField
        driver={ProviderDriverKind.make("codex")}
        value=""
        error="Instance ID is required."
        visible
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="add-provider-instance-id-error"');
    expect(html).toContain('id="add-provider-instance-id-error"');
    expect(html).toContain('role="alert"');
  });

  it("associates the help text without creating an alert", () => {
    const html = renderToStaticMarkup(
      <ProviderInstanceIdField
        driver={ProviderDriverKind.make("codex")}
        value="codex_work"
        error={null}
        visible
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain('aria-invalid="false"');
    expect(html).toContain('aria-describedby="add-provider-instance-id-help"');
    expect(html).toContain('id="add-provider-instance-id-help"');
    expect(html).not.toContain('role="alert"');
  });
});
