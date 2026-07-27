import { describe, expect, it } from "vite-plus/test";

import bootShellHtml from "../index.html?raw";
import chatViewSource from "./components/ChatView.tsx?raw";
import sidebarChromeSource from "./components/sidebar/SidebarChrome.tsx?raw";
import mainSource from "./main.tsx?raw";
import rootRouteSource from "./routes/__root.tsx?raw";
import {
  buildStartupLogoFlightKeyframes,
  createStartupSplashGate,
  resolveStartupSplashExitDuration,
  STARTUP_SPLASH_EXIT_MS,
  STARTUP_SPLASH_HOLD_MS,
  STARTUP_SPLASH_REDUCED_EXIT_MS,
} from "./startupSplash";

describe("startup splash", () => {
  it("holds the cold-launch splash for three seconds before the exit choreography", () => {
    expect(STARTUP_SPLASH_HOLD_MS).toBe(3_000);
    expect(STARTUP_SPLASH_EXIT_MS).toBe(820);
    expect(STARTUP_SPLASH_REDUCED_EXIT_MS).toBe(180);
    expect(resolveStartupSplashExitDuration(false)).toBe(820);
    expect(resolveStartupSplashExitDuration(true)).toBe(180);
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

  it("builds a curved shared-element flight into the real sidebar logo size", () => {
    const keyframes = buildStartupLogoFlightKeyframes(
      { left: 780, top: 468, width: 64, height: 64 },
      { left: 12, top: 12, width: 24, height: 24 },
    );

    expect(keyframes).toHaveLength(4);
    expect(keyframes[1]).toMatchObject({ offset: 0.24, opacity: 1 });
    expect(keyframes[2]).toMatchObject({ offset: 0.7, opacity: 1 });
    expect(keyframes[3]).toMatchObject({
      offset: 1,
      transform: "translate3d(-788px, -476px, 0) scale(0.375)",
    });
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
