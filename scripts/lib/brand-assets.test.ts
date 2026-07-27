import { describe, expect, it } from "vite-plus/test";
// @effect-diagnostics nodeBuiltinImport:off - These tests inspect checked-in image bytes directly.
import * as NodeFS from "node:fs";
import { PNG } from "pngjs";

import {
  BRAND_ASSET_PATHS,
  DEVELOPMENT_ICON_OVERRIDES,
  DEVELOPMENT_PUBLIC_ICON_OVERRIDES,
  resolveWebAssetBrandForChannel,
  resolveWebAssetBrandForPackageVersion,
  resolveWebIconOverrides,
} from "./brand-assets.ts";

const readRepositoryFile = (relativePath: string) =>
  NodeFS.readFileSync(new URL(`../../${relativePath}`, import.meta.url));

function expectTransparentPngCorners(contents: Buffer) {
  const png = PNG.sync.read(contents);
  const cornerAlpha = [
    png.data[3],
    png.data[(png.width - 1) * 4 + 3],
    png.data[(png.height - 1) * png.width * 4 + 3],
    png.data[(png.width * png.height - 1) * 4 + 3],
  ];

  expect(cornerAlpha).toEqual([0, 0, 0, 0]);
}

function expectTransparentIcoCorners(contents: Buffer) {
  const imageCount = contents.readUInt16LE(4);

  expect(imageCount).toBeGreaterThan(0);

  for (let index = 0; index < imageCount; index += 1) {
    const entryOffset = 6 + index * 16;
    const imageLength = contents.readUInt32LE(entryOffset + 8);
    const imageOffset = contents.readUInt32LE(entryOffset + 12);

    expectTransparentPngCorners(contents.subarray(imageOffset, imageOffset + imageLength));
  }
}

describe("brand-assets", () => {
  it("maps production web assets into the server package", () => {
    expect(resolveWebIconOverrides("production", "dist/client")).toEqual([
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFaviconIco,
        targetRelativePath: "dist/client/favicon.ico",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon16Png,
        targetRelativePath: "dist/client/favicon-16x16.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon32Png,
        targetRelativePath: "dist/client/favicon-32x32.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
        targetRelativePath: "dist/client/apple-touch-icon.png",
      },
    ]);
  });

  it("maps the V3 fork's server build web assets to production branding", () => {
    expect(DEVELOPMENT_ICON_OVERRIDES[0]).toEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.productionWebFaviconIco,
      targetRelativePath: "dist/client/favicon.ico",
    });
  });

  it("maps V3 web assets to the development splash and favicon files", () => {
    expect(DEVELOPMENT_PUBLIC_ICON_OVERRIDES).toEqual([
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFaviconIco,
        targetRelativePath: "apps/web/public/favicon.ico",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon16Png,
        targetRelativePath: "apps/web/public/favicon-16x16.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon32Png,
        targetRelativePath: "apps/web/public/favicon-32x32.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
        targetRelativePath: "apps/web/public/apple-touch-icon.png",
      },
    ]);
  });

  it("can target hosted web dist directly", () => {
    expect(resolveWebIconOverrides("production", "apps/web/dist")).toContainEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
      targetRelativePath: "apps/web/dist/apple-touch-icon.png",
    });
  });

  it("maps hosted nightly web assets to nightly icons", () => {
    expect(resolveWebIconOverrides("nightly", "apps/web/dist")).toContainEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
      targetRelativePath: "apps/web/dist/favicon.ico",
    });
  });

  it("maps hosted release channels to web asset brands", () => {
    expect(resolveWebAssetBrandForChannel("latest")).toBe("production");
    expect(resolveWebAssetBrandForChannel("nightly")).toBe("nightly");
  });

  it("maps package versions to web asset brands", () => {
    expect(resolveWebAssetBrandForPackageVersion("0.0.29")).toBe("production");
    expect(resolveWebAssetBrandForPackageVersion("0.0.29-nightly.20260723.882")).toBe("nightly");
    expect(resolveWebAssetBrandForPackageVersion("0.0.29-nightly.20260725.899.v3.0.0.1")).toBe(
      "production",
    );
  });

  it("keeps development, nightly, and production icon families separate", () => {
    expect([
      BRAND_ASSET_PATHS.developmentIconComposerProject,
      BRAND_ASSET_PATHS.nightlyIconComposerProject,
      BRAND_ASSET_PATHS.productionIconComposerProject,
    ]).toEqual([
      "assets/dev/app-icon.icon",
      "assets/nightly/app-icon.icon",
      "assets/prod/app-icon.icon",
    ]);
    expect(BRAND_ASSET_PATHS.developmentDesktopIconPng).toMatch(/^assets\/dev\/blueprint-/);
    expect(BRAND_ASSET_PATHS.nightlyMacIconPng).toMatch(/^assets\/nightly\/nightly-/);
    expect(BRAND_ASSET_PATHS.productionMacIconPng).toMatch(/^assets\/v3\/v3-code-nightly-v2-/);
  });

  it("keeps every V3 PNG icon and local splash copy transparent at the corners", () => {
    const pngPaths = [
      "assets/v3/v3-code-logo-nightly-v2-source.png",
      "assets/v3/v3-code-nightly-v2-16.png",
      "assets/v3/v3-code-nightly-v2-24.png",
      "assets/v3/v3-code-nightly-v2-32.png",
      "assets/v3/v3-code-nightly-v2-48.png",
      "assets/v3/v3-code-nightly-v2-64.png",
      "assets/v3/v3-code-nightly-v2-128.png",
      "assets/v3/v3-code-nightly-v2-180.png",
      "assets/v3/v3-code-nightly-v2-256.png",
      "assets/v3/v3-code-nightly-v2-1024.png",
      "apps/web/public/favicon-16x16.png",
      "apps/web/public/favicon-32x32.png",
      "apps/web/public/apple-touch-icon.png",
    ];

    for (const path of pngPaths) {
      expectTransparentPngCorners(readRepositoryFile(path));
    }
  });

  it("keeps every V3 ICO rendition transparent at the corners", () => {
    const icoPaths = [
      BRAND_ASSET_PATHS.productionWebFaviconIco,
      BRAND_ASSET_PATHS.productionWindowsIconIco,
      "apps/web/public/favicon.ico",
    ];

    for (const path of icoPaths) {
      expectTransparentIcoCorners(readRepositoryFile(path));
    }
  });
});
