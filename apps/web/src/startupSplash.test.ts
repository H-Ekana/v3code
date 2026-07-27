import { describe, expect, it } from "vite-plus/test";

import bootShellHtml from "../index.html?raw";
import chatViewSource from "./components/ChatView.tsx?raw";
import sidebarChromeSource from "./components/sidebar/SidebarChrome.tsx?raw";
import mainSource from "./main.tsx?raw";
import rootRouteSource from "./routes/__root.tsx?raw";
import {
  buildStartupLogoFlightKeyframes,
  createStartupSplashGate,
  easeStartupLogoSlingshot,
  resolveStartupSplashExitDuration,
  STARTUP_LOGO_FLIGHT_DELAY_MS,
  STARTUP_LOGO_FLIGHT_MS,
  STARTUP_SPLASH_EXIT_MS,
  STARTUP_SPLASH_HOLD_MS,
  STARTUP_SPLASH_REDUCED_EXIT_MS,
} from "./startupSplash";

describe("startup splash", () => {
  it("holds the cold-launch splash before running the exit choreography", () => {
    expect(STARTUP_SPLASH_HOLD_MS).toBe(1_800);
    expect(STARTUP_SPLASH_EXIT_MS).toBe(1_400);
    expect(STARTUP_SPLASH_REDUCED_EXIT_MS).toBe(180);
    expect(resolveStartupSplashExitDuration(false)).toBe(1_400);
    expect(resolveStartupSplashExitDuration(true)).toBe(180);
  });

  it("keeps the logo flight inside the exit window", () => {
    expect(STARTUP_LOGO_FLIGHT_DELAY_MS + STARTUP_LOGO_FLIGHT_MS).toBeLessThan(
      STARTUP_SPLASH_EXIT_MS,
    );
  });

  it("loads up slowly before launching the mark", () => {
    expect(easeStartupLogoSlingshot(0)).toBe(0);
    expect(easeStartupLogoSlingshot(1)).toBeCloseTo(1, 10);
    // A third of the duration buys less than a tenth of the path — that gap is the wind-up.
    expect(easeStartupLogoSlingshot(0.32)).toBeCloseTo(0.09, 10);
  });

  it("waits for both the compulsory hold and a committed app screen", () => {
    const scheduled: Array<() => void> = [];
    let exits = 0;
    const gate = createStartupSplashGate({
      onExit: () => {
        exits += 1;
      },
      schedule: (callback, delayMs) => {
        expect(delayMs).toBe(STARTUP_SPLASH_HOLD_MS);
        scheduled.push(callback);
        return scheduled.length;
      },
    });

    gate.markAppReady();
    expect(exits).toBe(0);
    scheduled[0]?.();
    expect(exits).toBe(1);
    gate.markAppReady();
    scheduled[0]?.();
    expect(exits).toBe(1);
  });

  it("keeps holding when time elapses before the app commits", () => {
    let releaseHold: (() => void) | undefined;
    let exits = 0;
    const gate = createStartupSplashGate({
      onExit: () => {
        exits += 1;
      },
      schedule: (callback) => {
        releaseHold = callback;
        return 1;
      },
    });

    releaseHold?.();
    expect(exits).toBe(0);
    gate.markAppReady();
    expect(exits).toBe(1);
  });

  it("slingshots downward before arcing into the real sidebar logo size", () => {
    const keyframes = buildStartupLogoFlightKeyframes(
      { left: 780, top: 468, width: 64, height: 64 },
      { left: 12, top: 12, width: 24, height: 24 },
    );

    const translateY = (frame: Keyframe) =>
      Number(/translate3d\([^,]+,\s*(-?[\d.]+)px/.exec(String(frame.transform))?.[1] ?? "0");

    expect(keyframes.length).toBeGreaterThan(16);

    // The target sits up and to the left, so any downward travel is deliberate wind-up
    // rather than a step along the direct path. Without this the flight is a straight line.
    const windUp = Math.max(...keyframes.slice(0, 8).map(translateY));
    expect(windUp).toBeGreaterThan(0);

    // ...and it still lands exactly on the measured target, free of float drift.
    expect(keyframes.at(-1)).toEqual({
      offset: 1,
      transform: "translate3d(-788px, -476px, 0) rotate(0deg) scale(0.375)",
    });
  });

  it("sandwiches the app between the sky so rising content passes through it", () => {
    // Paint order: shell, then foreground clouds, then the logo.
    expect(bootShellHtml).toMatch(
      /<div id="boot-shell"[\s\S]*<div id="boot-foreground"[\s\S]*<div id="boot-logo"/,
    );

    // The shell drops beneath #root while the layers above it stay put. Without the
    // explicit stacking context on #root the order depends on an opacity side effect.
    expect(bootShellHtml).toMatch(
      /html\[data-startup-splash="exiting"\] #boot-shell \{\s*z-index: 0;/,
    );
    expect(bootShellHtml).toMatch(
      /html\[data-startup-splash="exiting"\] #root \{\s*position: relative;\s*z-index: 1;/,
    );

    // The layers sit above a live, interactive app — they must never take a click.
    expect(bootShellHtml).toMatch(/\.v3-splash-layer \{\s*pointer-events: none;/);

    // Every layer has to be dismissed on a bypassed reload, not just the shell.
    for (const id of ["boot-shell", "boot-foreground", "boot-logo"]) {
      expect(bootShellHtml).toContain(`html[data-startup-splash="bypass"] #${id}`);
    }
  });

  it("keeps the boot shell above an independently mounted app root", () => {
    expect(bootShellHtml).toMatch(/<div id="root"><\/div>\s*<div\s+id="boot-shell"/);
    expect(bootShellHtml).toContain('const sessionKey = "v3code:startup-splash-seen"');
    expect(bootShellHtml).toContain('dataset.startupSplash = hasPlayed ? "bypass" : "holding"');
    expect(bootShellHtml).toContain('html[data-startup-splash="exiting"] #root');
    expect(bootShellHtml).toContain("@keyframes v3-startup-composer-arrive");
    expect(bootShellHtml).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("connects the controller to the real application targets", () => {
    expect(mainSource).toContain("startStartupSplashTransition();");
    expect(rootRouteSource).toContain("markStartupSplashAppReady");
    expect(sidebarChromeSource).toContain('data-startup-logo-target=""');
    expect(chatViewSource).toContain('data-startup-composer-target=""');
  });
});
