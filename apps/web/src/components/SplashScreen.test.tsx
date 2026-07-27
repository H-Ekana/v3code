import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import bootShellHtml from "../../index.html?raw";
import signalSvg from "../../public/v3-splash-signal.svg?raw";
import starsSvg from "../../public/v3-splash-stars.svg?raw";
import { SplashScreen } from "./SplashScreen";

const SPLASH_AMBIENT_ART_PATHS = [
  "/v3-splash-stars.svg",
  "/v3-splash-clouds-midground-v2.webp",
  "/v3-splash-clouds-foreground-v2.webp",
] as const;
const SPLASH_SIGNAL_PATH = "/v3-splash-signal.svg";

describe("SplashScreen", () => {
  it("keeps the ambient scene available to the static overlay and React fallback", () => {
    const reactMarkup = renderToStaticMarkup(<SplashScreen />);

    for (const path of SPLASH_AMBIENT_ART_PATHS) {
      expect(bootShellHtml).toContain(path);
      expect(reactMarkup).toContain(path);
    }
    expect(bootShellHtml).not.toContain('src="/v3-splash-clouds.svg"');
    expect(reactMarkup).not.toContain('src="/v3-splash-clouds.svg"');
    expect(bootShellHtml).toContain(SPLASH_SIGNAL_PATH);
    expect(reactMarkup).not.toContain(SPLASH_SIGNAL_PATH);
    expect(bootShellHtml).toContain("v3-splash-card");
    expect(reactMarkup).toContain("v3-splash-card");
    expect(bootShellHtml).toMatch(/<div id="root"><\/div>\s*<div\s+id="boot-shell"/);
    expect(
      bootShellHtml.match(/v3-splash-clouds-foreground v3-splash-clouds-foreground-/g),
    ).toHaveLength(3);
    expect(
      reactMarkup.match(/v3-splash-clouds-foreground v3-splash-clouds-foreground-/g),
    ).toHaveLength(3);
  });

  it("keeps the SVG scene transparent and within the shared responsive viewBox", () => {
    for (const svg of [starsSvg, signalSvg]) {
      expect(svg).toContain('viewBox="0 0 1600 1000"');
    }
    expect(starsSvg).not.toContain("<rect");
    expect(signalSvg).not.toContain('width="1600" height="1000"');
    expect(starsSvg).toContain("#FF8FD2");
    expect(signalSvg).toContain("#8C63E8");
    expect(bootShellHtml).toContain("v3-splash-cloud-layer");
    expect(bootShellHtml).toContain("left: -10%");
    expect(bootShellHtml).toContain("width: 120%");
    expect(bootShellHtml).toContain("max-width: none");
  });

  it("uses varied ambient motion with reduced-motion fallbacks", () => {
    expect(starsSvg).toContain("@keyframes star-twinkle");
    expect(starsSvg).toContain("spark-twinkle--a");
    expect(starsSvg).toContain("spark-twinkle--b");
    expect(starsSvg).toContain("spark-twinkle--c");
    expect(starsSvg).toContain("--twinkle-duration: 4s");
    expect(starsSvg).toContain("drop-shadow(0 0 12px");
    expect(starsSvg).toContain("@keyframes star-drift");
    expect(starsSvg).toContain(".star-drift--a");
    expect(starsSvg).toContain(".star-drift--e");
    expect(starsSvg).toContain("translate: var(--drift-from)");
    expect(starsSvg.match(/class="[^"]*star-drift star-drift--/g)).toHaveLength(33);
    expect(starsSvg).not.toContain("@keyframes sky-pan");
    expect(starsSvg).not.toContain("@keyframes sky-rotation");
    expect(starsSvg).not.toContain('class="sky-pan"');
    expect(starsSvg).not.toContain('class="sky-overscan"');
    expect(starsSvg).toContain('id="meteor-tail"');
    expect(starsSvg).toContain("@keyframes meteor-origin-hide");
    expect(starsSvg).toContain("@keyframes shooting-star-a");
    expect(starsSvg).toContain("@keyframes shooting-star-b");
    expect(starsSvg).toContain("@keyframes shooting-star-c");
    expect(starsSvg.match(/class="shooting-star shooting-star--/g)).toHaveLength(3);
    expect(bootShellHtml).toContain("@keyframes v3-cloud-mid-drift");
    expect(bootShellHtml).toContain("@keyframes v3-cloud-foreground-left-drift");
    expect(bootShellHtml).toContain("@keyframes v3-cloud-foreground-center-drift");
    expect(bootShellHtml).toContain("@keyframes v3-cloud-foreground-right-drift");
    expect(bootShellHtml).toContain("v3-splash-clouds-mid");
    expect(bootShellHtml).toContain("v3-splash-clouds-foreground-left");
    expect(bootShellHtml).toContain("v3-splash-clouds-foreground-center");
    expect(bootShellHtml).toContain("v3-splash-clouds-foreground-right");
    expect(bootShellHtml).toContain("12s cubic-bezier");
    expect(bootShellHtml).toContain("15s cubic-bezier");
    expect(bootShellHtml).toContain("18s cubic-bezier");
    expect(bootShellHtml).toContain("14s cubic-bezier");
    expect(bootShellHtml).toContain("translate3d(-3.2%, 7px, 0)");
    expect(bootShellHtml).toContain("translate3d(3.1%, 1px, 0)");
    expect(bootShellHtml).toContain("translate3d(1.6%, 5px, 0)");
    expect(bootShellHtml).toContain("translate3d(-1.3%, 1px, 0)");
    expect(bootShellHtml).toContain("translate3d(-0.8%, 3px, 0)");
    expect(bootShellHtml).toContain("translate3d(1.2%, 0, 0)");
    expect(bootShellHtml).toContain("translate3d(1.4%, 6px, 0)");
    expect(bootShellHtml).toContain("translate3d(-1.7%, 2px, 0)");
    expect(bootShellHtml).toContain(
      "mask-image: linear-gradient(to bottom, #000 0%, #000 38%, transparent 72%)",
    );
    expect(signalSvg).toContain("@keyframes signal-incoming");
    expect(signalSvg).toContain("@keyframes signal-outgoing");
    expect(signalSvg).toContain("signal-orbit-segment");
    expect(signalSvg).toContain("signal-node--4");
    expect(signalSvg).toContain("@keyframes signal-residue-fade");
    expect(signalSvg).toContain("840ms");
    expect(signalSvg).not.toContain("<animateMotion");
    expect(signalSvg).not.toContain("stroke-dashoffset");
    expect(signalSvg).not.toContain("<filter");

    for (const svg of [starsSvg, signalSvg]) {
      expect(svg).toContain("@media (prefers-reduced-motion: reduce)");
    }
    expect(bootShellHtml).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
