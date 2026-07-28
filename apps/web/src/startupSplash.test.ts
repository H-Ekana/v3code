import { describe, expect, it } from "vite-plus/test";

import bootShellHtml from "../index.html?raw";
import chatViewSource from "./components/ChatView.tsx?raw";
import chatHeaderSource from "./components/chat/ChatHeader.tsx?raw";
import sidebarChromeSource from "./components/sidebar/SidebarChrome.tsx?raw";
import mainSource from "./main.tsx?raw";
import rootRouteSource from "./routes/__root.tsx?raw";
import startupSplashSource from "./startupSplash.ts?raw";
import {
  buildStartupLogoFlightKeyframes,
  createStartupSplashGate,
  resolveCloudBandMotion,
  resolveStartupSplashExitDuration,
  buildHeroMeteorKeyframes,
  STARTUP_LOGO_FLIGHT_DELAY_MS,
  STARTUP_LOGO_FLIGHT_MS,
  STARTUP_METEOR_MS,
  STARTUP_PARTING_DELAY_MS,
  STARTUP_SPLASH_EXIT_MS,
  STARTUP_SPLASH_HOLD_MS,
  STARTUP_SPLASH_REDUCED_EXIT_MS,
} from "./startupSplash";

describe("startup splash", () => {
  it("holds the cold-launch splash before running the exit choreography", () => {
    expect(STARTUP_SPLASH_HOLD_MS).toBe(1_600);
    expect(STARTUP_SPLASH_EXIT_MS).toBe(2_500);
    expect(STARTUP_SPLASH_REDUCED_EXIT_MS).toBe(300);
    expect(resolveStartupSplashExitDuration(false)).toBe(2_500);
    expect(resolveStartupSplashExitDuration(true)).toBe(300);
  });

  it("orders the causal chain: strike, then departure, then the sky parting", () => {
    // The mark cannot begin moving before the thing that hits it arrives, and the sky must
    // not open while the mark is still the focus. Each beat causes the next.
    expect(STARTUP_LOGO_FLIGHT_DELAY_MS).toBe(STARTUP_METEOR_MS);
    expect(STARTUP_PARTING_DELAY_MS).toBeGreaterThan(STARTUP_METEOR_MS);

    // Every beat has to finish before the boot layers are swept away.
    expect(STARTUP_LOGO_FLIGHT_DELAY_MS + STARTUP_LOGO_FLIGHT_MS).toBeLessThan(
      STARTUP_SPLASH_EXIT_MS,
    );
    expect(STARTUP_PARTING_DELAY_MS).toBeLessThan(STARTUP_SPLASH_EXIT_MS);
  });

  it("lands the meteor's head exactly on the mark", () => {
    const keyframes = buildHeroMeteorKeyframes();

    // The head sits at the group's local origin, so a zero translate is contact. If this
    // drifts, the strike visibly misses the logo it is supposed to knock loose.
    const contact = keyframes.at(-1);
    expect(String(contact?.transform)).toContain("translate(0px, 0px)");
    expect(contact?.opacity).toBe(0);

    // It has to be visible on approach, not just at the moment of impact.
    expect(Number(keyframes[1]?.opacity)).toBeGreaterThan(0.5);
  });

  it("moves every arriving surface by transform alone", () => {
    // A CSS timing function applies per interval to EVERY property in it, so bundling opacity
    // into a travel keyframe makes the fade ride the travel curve. On ease-out-expo that left
    // an element ~91% of the way to its destination before it was visible at all, which is
    // indistinguishable from it simply appearing there.
    //
    // These now animate transform ONLY — each starts off-screen, so no fade is needed, and a
    // partial opacity anywhere on this path would flatten the composer's glass.
    for (const name of ["composer-rise", "sidebar-slide", "workspace-rise"]) {
      const block = new RegExp(`@keyframes v3-startup-${name} \\{[^@]*?\\n      \\}`, "s").exec(
        bootShellHtml,
      )?.[0];
      expect(block, `missing @keyframes v3-startup-${name}`).toBeDefined();
      expect(block).not.toContain("opacity");
      expect(block).toContain("transform");
    }

    for (const selector of [
      "[data-app-sidebar]",
      '[data-slot="sidebar-inset"]',
      "[data-startup-composer-target]",
    ]) {
      expect(bootShellHtml).toContain(selector);
    }
  });

  it("never puts a partial opacity on the composer or anything above it", () => {
    // Per the Filter Effects spec an element with opacity < 1 becomes a Backdrop Root for its
    // descendants. The composer's glass is a backdrop-filter on its ::before, so a fade on
    // #root, on the workspace, or on the composer itself makes that glass sample an empty
    // backdrop and render flat — then snap to its real saturated appearance the moment the
    // fade completes. That snap is the saturation jump.
    //
    // Ordering the fades cannot fix it; only removing them can. Everything on this path
    // arrives by transform. The composer starts below the fold, so it needs no fade at all.
    const ancestorsAndSelf = [
      "#root",
      '\\[data-slot="sidebar-inset"\\]',
      "\\[data-startup-composer-target\\]",
    ];

    for (const selector of ancestorsAndSelf) {
      const block = new RegExp(
        `\\[data-startup-splash="exiting"\\] ${selector} \\{[\\s\\S]*?\\n      \\}`,
      ).exec(bootShellHtml)?.[0];

      // Guard the guard: a selector that stops matching would make every assertion vacuous.
      expect(block, `no exiting rule found for ${selector}`).toBeDefined();
      expect(block).not.toContain("v3-startup-fade-in");
      // `opacity: 1` is fine — it is the absence of a partial value that matters.
      expect(block).not.toMatch(/opacity:\s*0?\.\d/);
    }

    // And the keyframes those rules reference must not animate opacity either.
    for (const name of ["composer-rise", "workspace-rise"]) {
      const frames = new RegExp(`@keyframes v3-startup-${name} \\{[^@]*?\\n      \\}`, "s").exec(
        bootShellHtml,
      )?.[0];
      expect(frames, `missing @keyframes v3-startup-${name}`).toBeDefined();
      expect(frames).not.toContain("opacity");
    }
  });

  it("gives the cloud bands genuinely different depths", () => {
    const mid = resolveCloudBandMotion("v3-splash-cloud-layer v3-splash-clouds-mid");
    const near = resolveCloudBandMotion(
      "v3-splash-cloud-layer v3-splash-clouds-foreground v3-splash-clouds-foreground-center",
    );

    // Depth is read from RELATIVE velocity. Near-identical motion across layers reads as one
    // flat sheet no matter how many layers there are.
    const midVelocity = Number.parseFloat(mid.y) / mid.durationMs;
    const nearVelocity = Number.parseFloat(near.y) / near.durationMs;
    expect(nearVelocity / midVelocity).toBeGreaterThan(2);

    // Scale gradient is an independent depth cue: the nearer band approaches the viewer.
    expect(near.scale).toBeGreaterThan(mid.scale);
  });

  it("keeps the logo flight inside the exit window", () => {
    expect(STARTUP_LOGO_FLIGHT_DELAY_MS + STARTUP_LOGO_FLIGHT_MS).toBeLessThan(
      STARTUP_SPLASH_EXIT_MS,
    );
  });

  it("hides every copy of the app mark in the chrome until the flight delivers one", () => {
    // The sidebar brand was hidden for rounds while the user kept seeing "the logo already
    // there" — because the ChatHeader's PROJECT favicon is, for a project like v3code, the
    // same V3 mark, rendered by a different element the sidebar rule never touched. Both
    // stand-ins must be suppressed during the splash states.
    for (const attr of ["data-startup-logo-target", "data-startup-brand-mark"]) {
      expect(bootShellHtml).toContain(`html[data-startup-splash="holding"] [${attr}]`);
      expect(bootShellHtml).toContain(`html[data-startup-splash="exiting"] [${attr}]`);
    }
    expect(chatHeaderSource).toContain('data-startup-brand-mark=""');
  });

  it("never reveals the sidebar mark before the flight has delivered it", () => {
    const source = String(startupSplashSource);
    const landing = /const handoffDelay = ([^;]+);/.exec(source)?.[1]?.trim();

    // The handoff must be exactly the landing moment. It was once `... - 140`, which faded
    // the destination mark up while the flying one was still in transit — so the logo
    // appeared at its destination before anything arrived to put it there, defeating the
    // entire point of the flight. Any subtraction here reintroduces that.
    expect(landing).toBe("STARTUP_LOGO_FLIGHT_DELAY_MS + STARTUP_LOGO_FLIGHT_MS");
    expect(landing).not.toMatch(/-/);

    // And a stale fill:forwards handoff outranks the CSS that hides the mark during the
    // hold, so arming the splash has to cancel the previous run's animations.
    expect(source).toMatch(
      /function armStartupSplash[\s\S]*?cancelStartupAnimations\(\s*document\.querySelector/,
    );
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

  it("recoils downward, sweeps left, then climbs into the sidebar", () => {
    // A 1600x900 window: mark centred, sidebar brand near the top-left corner.
    const keyframes = buildStartupLogoFlightKeyframes(
      { left: 768, top: 418, width: 64, height: 64 },
      { left: 40, top: 18, width: 24, height: 24 },
    );
    const deltaX = 52 - 800;
    const deltaY = 30 - 450;

    const at = (frame: Keyframe) => {
      const match = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(String(frame.transform));
      return { x: Number(match?.[1] ?? 0), y: Number(match?.[2] ?? 0) };
    };

    expect(keyframes.length).toBeGreaterThan(16);

    // The strike has to produce a real displacement. This previously came from a Bezier
    // control-point offset and measured 15px on a 900px viewport — present in the maths,
    // invisible on screen. Under ~120px means the recoil has silently collapsed again.
    const recoil = Math.max(...keyframes.map((frame) => at(frame).y));
    expect(recoil).toBeGreaterThan(120);

    // Partway in it must be well left AND still below where it started. That combination is
    // the corner of the J, and a straight diagonal cannot satisfy both at once.
    const corner = at(keyframes[Math.round((keyframes.length - 1) * 0.39)]!);
    expect(corner.x / deltaX).toBeGreaterThan(0.35);
    expect(corner.y).toBeGreaterThan(0);

    // Horizontal travel must stay spread across the duration. At 87% by halfway, the tail of
    // the animation is a vertical settle and the eye reads the whole thing as a diagonal.
    const halfway = at(keyframes[Math.round((keyframes.length - 1) * 0.5)]!);
    expect(halfway.x / deltaX).toBeLessThan(0.78);

    // ...and it still lands exactly on the measured target, free of float drift.
    expect(keyframes.at(-1)).toEqual({
      offset: 1,
      transform: `translate3d(${deltaX}px, ${deltaY}px, 0) rotate(0deg) scale(0.375)`,
    });
  });

  it("dissolves the sky on top of an already-opaque app instead of dropping behind it", () => {
    // Paint order: shell, then foreground clouds, then the logo.
    expect(bootShellHtml).toMatch(
      /<div id="boot-shell"[\s\S]*<div id="boot-foreground"[\s\S]*<div id="boot-logo"/,
    );

    // The shell must KEEP its z-index during the parting. An earlier design dropped it to
    // z-index 0 beneath #root — but that swap and the app turning opaque land in the same
    // frame, so the whole app popped into view behind the sky at T0. The reveal is the veil
    // clearing above the app, which means the shell has to stay on top while it dissolves.
    const shellExiting =
      /html\[data-startup-splash="exiting"\] #boot-shell \{[\s\S]*?\n      \}/.exec(
        bootShellHtml,
      )?.[0];
    expect(shellExiting, "missing exiting rule for #boot-shell").toBeDefined();
    expect(shellExiting).not.toContain("z-index");
    expect(shellExiting).toContain("pointer-events: none");

    // ...and the veil-open reveal must actually be scheduled during the exit.
    expect(bootShellHtml).toMatch(
      /html\[data-startup-splash="exiting"\] \.v3-splash::before \{\s*animation: v3-startup-veil-open/,
    );

    // The layers sit above a live, interactive app — they must never take a click.
    expect(bootShellHtml).toMatch(/\.v3-splash-layer \{\s*pointer-events: none;/);

    // Every layer has to be dismissed on a bypassed reload, not just the shell.
    for (const id of ["boot-shell", "boot-foreground", "boot-logo"]) {
      expect(bootShellHtml).toContain(`html[data-startup-splash="bypass"] #${id}`);
    }
  });

  it("carries two parallax mote fields at different depths", () => {
    // Both fields exist. Two occurrences of the shared class is the cheapest proof.
    const fieldCount = bootShellHtml.match(/v3-splash-motes/g)?.length ?? 0;
    expect(fieldCount).toBeGreaterThanOrEqual(2);
    expect(bootShellHtml).toContain("v3-splash-motes-far");
    expect(bootShellHtml).toContain("v3-splash-motes-near");

    // Paint order is occlusion. The FAR field must be painted before the midground cloud
    // (behind it, in the shell); the NEAR field before the first foreground cloud (behind the
    // foreground bands but above the app). If either falls after its cloud the depth inverts.
    // Anchor on the boot markup only — the class names also appear in the CSS and the <link
    // rel="preload"> tags in <head>, so a bare indexOf would compare the wrong occurrences.
    const bootMarkup = bootShellHtml.slice(bootShellHtml.indexOf('<div id="boot-shell"'));
    const farField = bootMarkup.indexOf(
      'class="v3-splash-art v3-splash-motes v3-splash-motes-far"',
    );
    const midCloud = bootMarkup.indexOf('src="/v3-splash-clouds-midground-v2.webp"');
    expect(farField).toBeGreaterThan(-1);
    expect(farField).toBeLessThan(midCloud);

    const nearField = bootMarkup.indexOf(
      'class="v3-splash-art v3-splash-motes v3-splash-motes-near"',
    );
    const firstForegroundCloud = bootMarkup.indexOf('src="/v3-splash-clouds-foreground-v2.webp"');
    expect(nearField).toBeGreaterThan(-1);
    expect(nearField).toBeLessThan(firstForegroundCloud);

    // The near field has to drift faster than the far field or there is no parallax. Compare
    // the shortest far loop against the longest near loop; even in the worst pairing near wins.
    const durations = (fieldSelector: RegExp) =>
      [...bootShellHtml.matchAll(fieldSelector)].map((match) => Number(match[1]));
    const farLoops = durations(/v3-mote-drift-far-[a-z] (\d+)s/g);
    const nearLoops = durations(/v3-mote-drift-near-[a-z] (\d+)s/g);
    expect(farLoops.length).toBeGreaterThan(0);
    expect(nearLoops.length).toBeGreaterThan(0);
    expect(Math.max(...nearLoops)).toBeLessThan(Math.min(...farLoops));

    // One will-change per drifting group, never per mote — motes must not each get a layer.
    expect(bootShellHtml).toMatch(/\.v3-splash-mote-group \{\s*will-change: transform;/);

    // Reduced motion freezes the drift; the fields then just leave with their layers.
    expect(bootShellHtml).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.v3-splash-mote-group,?\s*\{\s*animation: none;/,
    );
  });

  it("keeps the boot shell above an independently mounted app root", () => {
    expect(bootShellHtml).toMatch(/<div id="root"><\/div>\s*<div\s+id="boot-shell"/);
    expect(bootShellHtml).toContain('const sessionKey = "v3code:startup-splash-seen"');
    expect(bootShellHtml).toContain('dataset.startupSplash = hasPlayed ? "bypass" : "holding"');
    expect(bootShellHtml).toContain('html[data-startup-splash="exiting"] #root');
    expect(bootShellHtml).toContain("@keyframes v3-startup-composer-rise");
    expect(bootShellHtml).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("connects the controller to the real application targets", () => {
    expect(mainSource).toContain("startStartupSplashTransition();");
    expect(rootRouteSource).toContain("markStartupSplashAppReady");
    expect(sidebarChromeSource).toContain('data-startup-logo-target=""');
    expect(chatViewSource).toContain('data-startup-composer-target=""');
  });
});
