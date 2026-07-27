import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import bootShellHtml from "../../index.html?raw";
import cloudsSvg from "../../public/v3-splash-clouds.svg?raw";
import signalSvg from "../../public/v3-splash-signal.svg?raw";
import starsSvg from "../../public/v3-splash-stars.svg?raw";
import { SplashScreen } from "./SplashScreen";

const SPLASH_AMBIENT_ART_PATHS = ["/v3-splash-stars.svg", "/v3-splash-clouds.svg"] as const;
const SPLASH_SIGNAL_PATH = "/v3-splash-signal.svg";

describe("SplashScreen", () => {
  it("keeps the ambient scene across the React handoff without replaying the signal lock", () => {
    const reactMarkup = renderToStaticMarkup(<SplashScreen />);

    for (const path of SPLASH_AMBIENT_ART_PATHS) {
      expect(bootShellHtml).toContain(path);
      expect(reactMarkup).toContain(path);
    }
    expect(bootShellHtml).toContain(SPLASH_SIGNAL_PATH);
    expect(reactMarkup).not.toContain(SPLASH_SIGNAL_PATH);
    expect(bootShellHtml).toContain("v3-splash-card");
    expect(reactMarkup).toContain("v3-splash-card");
  });

  it("keeps the SVG scene transparent and within the shared responsive viewBox", () => {
    for (const svg of [starsSvg, signalSvg, cloudsSvg]) {
      expect(svg).toContain('viewBox="0 0 1600 1000"');
    }
    for (const svg of [starsSvg, cloudsSvg]) {
      expect(svg).not.toContain("<rect");
    }
    expect(signalSvg).not.toContain('width="1600" height="1000"');
    expect(starsSvg).toContain("#FF8FD2");
    expect(signalSvg).toContain("#8C63E8");
    expect(cloudsSvg).toContain("#EC4FA8");
  });

  it("uses varied ambient motion with reduced-motion fallbacks", () => {
    expect(starsSvg).toContain("@keyframes star-twinkle");
    expect(starsSvg).toContain("spark-twinkle--a");
    expect(starsSvg).toContain("spark-twinkle--b");
    expect(starsSvg).toContain("spark-twinkle--c");
    expect(cloudsSvg).toContain("@keyframes cloud-drift");
    expect(cloudsSvg).toContain("cloud-bank-left");
    expect(cloudsSvg).toContain("cloud-bank-right");
    expect(cloudsSvg).toContain("cloud-bank-center");
    expect(signalSvg).toContain("@keyframes signal-incoming");
    expect(signalSvg).toContain("@keyframes signal-outgoing");
    expect(signalSvg).toContain("signal-orbit-segment");
    expect(signalSvg).toContain("signal-node--4");
    expect(signalSvg).toContain("@keyframes signal-residue-fade");
    expect(signalSvg).toContain("840ms");
    expect(signalSvg).not.toContain("<animateMotion");
    expect(signalSvg).not.toContain("stroke-dashoffset");
    expect(signalSvg).not.toContain("<filter");

    for (const svg of [starsSvg, signalSvg, cloudsSvg]) {
      expect(svg).toContain("@media (prefers-reduced-motion: reduce)");
    }
  });
});
