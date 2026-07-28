/*
 * Generates apps/web/public/splash-lab.html — a standalone harness for iterating on the
 * cold-start choreography without launching the app.
 *
 * Fidelity rules, so the lab cannot quietly diverge from the real thing:
 *   - the splash <style> block and the boot-layer markup are copied VERBATIM from index.html
 *   - the app chrome uses the real compiled stylesheet and the real class strings from
 *     AppSidebarLayout / SidebarChrome / ChatView / DraftHeroHeadline
 *
 * Run: node scripts/build-splash-lab.mjs
 */
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const INDEX = "apps/web/index.html";
const DIST_ASSETS = "apps/web/dist/assets";
const OUT_HTML = "apps/web/public/splash-lab.html";
const OUT_CSS = "apps/web/public/splash-lab-app.css";

const html = readFileSync(INDEX, "utf8");
const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
const layerStart = html.indexOf('<div id="boot-shell"');
const layerEnd = html.indexOf('<script type="module"');
const layers = html.slice(layerStart, layerEnd).trimEnd();

// The real app stylesheet gives us genuine glass, tokens, fonts and sidebar treatment.
const appCss = readdirSync(DIST_ASSETS).find((f) => f.startsWith("index-") && f.endsWith(".css"));
if (!appCss) {
  throw new Error(`No compiled app CSS in ${DIST_ASSETS}. Run: vp run --filter ./apps/web build`);
}
copyFileSync(`${DIST_ASSETS}/${appCss}`, OUT_CSS);

// file:// and the lab server both need relative asset paths.
const rel = (s) =>
  s
    .replaceAll('="/v3-splash', '="./v3-splash')
    .replaceAll('="/apple-touch-icon', '="./apple-touch-icon');

const page = `<!doctype html>
<html lang="en" class="dark" data-startup-splash="holding">
  <head>
    <meta charset="UTF-8" />
    <title>Splash lab</title>
    <link rel="stylesheet" href="./splash-lab-app.css" />
    <style>
${rel(css)}
      /* Lab-only: stand in for the bits React would otherwise mount. */
      body { margin: 0; overflow: hidden; }
      #lab-bar { position: fixed; z-index: 200; right: 14px; bottom: 14px; display: flex; gap: 8px; }
      #lab-bar button { background: color-mix(in srgb, var(--primary) 22%, transparent);
        color: var(--foreground); border: 1px solid color-mix(in srgb, var(--primary) 40%, transparent);
        border-radius: 10px; padding: 9px 16px; font: 500 13px/1 var(--font-sans, system-ui);
        cursor: pointer; backdrop-filter: blur(8px); }
      #lab-bar button:hover { background: color-mix(in srgb, var(--primary) 34%, transparent); }
    </style>
  </head>
  <body>
    <div id="root">
      <div class="group/sidebar-wrapper flex min-h-svh w-full" style="--sidebar-width: 16rem">
        <div
          class="group peer hidden text-sidebar-foreground md:block"
          data-slot="sidebar" data-side="left" data-state="expanded"
          data-variant="sidebar" data-collapsible=""
        >
          <div class="relative w-(--sidebar-width) bg-transparent" data-slot="sidebar-gap"></div>
          <div
            data-app-sidebar=""
            class="fixed inset-y-0 left-0 z-10 hidden h-svh w-(--sidebar-width) md:flex border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
          >
            <div data-slot="sidebar-inner" class="flex h-full w-full flex-col bg-sidebar">
              <div
                data-slot="sidebar-header"
                class="@container/sidebar-header relative flex h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:px-0"
              >
                <a
                  class="sidebar-brand relative z-10 ml-[var(--workspace-titlebar-content-left)] flex h-8 w-fit min-w-0 shrink-0 items-center gap-1.5 overflow-hidden rounded-md text-foreground"
                  href="#"
                >
                  <img
                    alt="" aria-hidden="true"
                    class="size-6 shrink-0 rounded-md shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_18%,transparent)]"
                    data-startup-logo-target=""
                    src="./apple-touch-icon.png"
                  />
                  <span class="truncate text-base font-medium tracking-tight text-muted-foreground">Code</span>
                </a>
              </div>
              <div class="flex-1 px-2 py-2 text-sidebar-muted-foreground text-sm">
                <div class="px-2 py-1.5 opacity-60">Threads</div>
              </div>
            </div>
          </div>
        </div>

        <main
          data-slot="sidebar-inset"
          class="relative flex min-w-0 w-full flex-1 flex-col bg-background surface-grain"
        >
          <div
            data-chat-composer-overlay="hero"
            class="pointer-events-none absolute inset-0 z-20 flex items-center"
          >
            <div class="chat-composer-horizontal-inset w-full">
              <div class="pointer-events-auto relative z-10">
                <div class="absolute inset-x-0 bottom-full z-0">
                  <div class="pb-8" data-startup-headline-target="">
                    <h1 class="mx-auto w-full max-w-5xl text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
                      What should we build in <span class="text-foreground">Dash</span>?
                    </h1>
                  </div>
                </div>
                <div class="relative">
                  <div
                    data-startup-composer-target=""
                    class="chat-composer-glass-shell relative mx-auto w-full max-w-3xl"
                  >
                    <div class="chat-composer-glass-host relative z-10 w-full rounded-[22px]">
                      <div class="flex min-h-[104px] flex-col justify-between gap-3 px-4 py-3">
                        <div class="text-muted-foreground/70 text-base">Plan, search, build anything</div>
                        <div class="flex items-center justify-between">
                          <div class="flex gap-2">
                            <div class="size-7 rounded-lg bg-foreground/8"></div>
                            <div class="size-7 rounded-lg bg-foreground/8"></div>
                          </div>
                          <div class="size-8 rounded-lg bg-primary/70"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
${rel(layers)}
    <div id="lab-bar"><button id="lab-replay">Replay splash</button></div>
    <script type="module" src="./splash-lab.js"></script>
  </body>
</html>
`;

writeFileSync(OUT_HTML, page, "utf8");
console.log(`wrote ${OUT_HTML}`);
console.log(`  splash css: ${css.length}b, boot markup: ${layers.length}b, app css: ${appCss}`);
