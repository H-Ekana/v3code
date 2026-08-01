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
    // The shared foreground texture is split into three masked bands so each region can move
    // independently without loading three different assets.
    expect(
      bootShellHtml.match(/v3-splash-clouds-foreground v3-splash-clouds-foreground-/g),
    ).toHaveLength(3);
    expect(bootShellHtml).not.toContain("v3-splash-cloud-rim");
    expect(bootShellHtml).not.toMatch(/exiting"\] \.v3-splash-clouds/);
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

  it("keeps the ambient scene alive within a bounded animation budget", () => {
    const animatedStarGroups = starsSvg.match(/class="star-field star-field--/g) ?? [];
    const animatedSparks = starsSvg.match(/class="[^"]*spark-twinkle spark-twinkle--/g) ?? [];
    const meteorOrigins = starsSvg.match(/class="meteor-origin meteor-origin--/g) ?? [];
    const shootingStars = starsSvg.match(/class="shooting-star shooting-star--/g) ?? [];

    expect(animatedStarGroups).toHaveLength(5);
    expect(animatedSparks).toHaveLength(6);
    expect(meteorOrigins).toHaveLength(6);
    expect(shootingStars).toHaveLength(6);
    expect(starsSvg).toContain("Five field-level transforms replace the original per-star drift");
    expect(starsSvg).toContain("@keyframes star-field-drift");
    expect(starsSvg).toContain("@keyframes star-twinkle");
    expect(starsSvg).toContain("0%, 100% { opacity: .1; }");
    expect(starsSvg).toContain("42%, 48% { opacity: 1; }");
    for (const duration of ["2.4s", "2.8s", "3.2s"]) {
      expect(starsSvg).toContain(duration);
    }
    expect(starsSvg).toContain("@keyframes meteor-origin-hide");
    for (const key of ["a", "b", "c", "d", "e", "f"]) {
      expect(starsSvg).toContain(`@keyframes shooting-star-${key}`);
    }
    for (const delay of ["0s", "-.5s", "-1s", "-1.5s", "-2s", "-2.5s"]) {
      expect(starsSvg).toContain(`animation-delay: ${delay}`);
    }
    expect(starsSvg).toContain("animation-duration: 3s");
    expect(starsSvg).not.toContain("star-drift");
    expect(starsSvg).not.toContain("filter:");
    expect(starsSvg).not.toContain("will-change:");
    expect(starsSvg).toContain("@media (prefers-reduced-motion: reduce)");
    expect(starsSvg).not.toContain('class="sky-pan"');
    expect(starsSvg).not.toContain('class="sky-overscan"');
    expect(starsSvg).toContain('id="meteor-tail"');
    expect(bootShellHtml).toContain("@keyframes v3-cloud-mid-drift");
    expect(bootShellHtml).toContain("@keyframes v3-cloud-foreground-left-drift");
    expect(bootShellHtml).toContain("@keyframes v3-cloud-foreground-center-drift");
    expect(bootShellHtml).toContain("@keyframes v3-cloud-foreground-right-drift");
    expect(bootShellHtml).toContain("v3-splash-clouds-mid");
    expect(bootShellHtml).toContain("v3-splash-clouds-foreground-left");
    expect(bootShellHtml).toContain("v3-splash-clouds-foreground-center");
    expect(bootShellHtml).toContain("v3-splash-clouds-foreground-right");
    expect(bootShellHtml).toContain("v3-cloud-mid-drift 15s");
    expect(bootShellHtml).toContain("v3-cloud-foreground-left-drift 12s");
    expect(bootShellHtml).toContain("v3-cloud-foreground-center-drift 17s");
    expect(bootShellHtml).toContain("v3-cloud-foreground-right-drift 13.5s");
    expect(bootShellHtml).toContain("translate3d(-0.55%, 1.5px, 0) scale(1.004)");
    expect(bootShellHtml).toContain("translate3d(0.6%, -1.5px, 0) scale(1.009)");
    expect(bootShellHtml).toContain("translate3d(0.75%, 2px, 0) scale(1.006)");
    expect(bootShellHtml).toContain("translate3d(-0.45%, 1.5px, 0) scale(1.005)");
    expect(bootShellHtml).toContain("translate3d(0.65%, 2px, 0) scale(1.006)");
    expect(bootShellHtml).toContain("opacity: 0.15");
    expect(bootShellHtml).toContain("opacity: 0.25");
    expect(bootShellHtml).toContain("saturate(0.52) brightness(0.68)");
    expect(bootShellHtml).toContain("saturate(0.58) brightness(0.7)");
    expect(bootShellHtml).toContain("saturate(0.52) brightness(0.58)");
    expect(bootShellHtml).toContain("saturate(0.6) brightness(0.62)");
    expect(bootShellHtml).toContain(
      "mask-image: linear-gradient(to bottom, #000 0%, #000 38%, transparent 72%)",
    );
    expect(signalSvg).toContain("@keyframes signal-incoming");
    expect(signalSvg).toContain("@keyframes signal-outgoing");
    expect(signalSvg).toContain("signal-orbit-segment");
    expect(signalSvg).toContain("signal-node--4");
    expect(signalSvg).toContain("@keyframes signal-residue-fade");
    expect(signalSvg).toContain("840ms");
    expect(signalSvg).toContain("The startup controller owns the only one-shot clock");
    expect(signalSvg).toMatch(/\.signal-orbit-segment,[\s\S]*?animation: none;/);
    expect(signalSvg).not.toContain("<animateMotion");
    expect(signalSvg).not.toContain("<filter");
    // stroke-dashoffset is deliberately allowed: the constellation links draw themselves in
    // (pathLength-normalised line-draw with a travelling spark). Its repaint cost is
    // negligible on three thin sub-200px paths, unlike the SMIL and <filter> bans above.
    expect(signalSvg).toContain('pathLength="1"');
    expect(signalSvg).toContain("@keyframes signal-link-draw");

    expect(signalSvg).toContain("@media (prefers-reduced-motion: reduce)");
    expect(bootShellHtml).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
