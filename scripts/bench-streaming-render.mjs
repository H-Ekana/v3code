#!/usr/bin/env node

import * as NodeModule from "node:module";
import * as NodePerfHooks from "node:perf_hooks";
import * as NodeURL from "node:url";

import { remarkNormalizeListItemIndentation } from "../apps/web/src/markdown-list-indentation.ts";

const DELTA_CHARS = 40;
const FINAL_SIZES = [1_000, 5_000, 20_000, 50_000];
const PLAIN_MODE = process.argv.includes("--plain");
// The default fixture fills all growth with one code fence, so the markdown
// parser only ever sees a single cheap code node no matter how large the
// message gets. That measures Shiki well but says nothing about prose, which is
// the path an incremental-markdown fix would actually address. `--prose` swaps
// the filler for structurally varied prose and emits no fence at all.
const PROSE_MODE = process.argv.includes("--prose");
const KNOWN_ARGS = new Set(["--plain", "--prose"]);
const UNKNOWN_ARGS = process.argv.slice(2).filter((argument) => !KNOWN_ARGS.has(argument));

if (UNKNOWN_ARGS.length > 0) {
  console.error(
    `Unknown argument${UNKNOWN_ARGS.length === 1 ? "" : "s"}: ${UNKNOWN_ARGS.join(" ")}`,
  );
  console.error("Usage: node scripts/bench-streaming-render.mjs [--plain] [--prose]");
  process.exit(1);
}

// Resolve the exact dependency instances used by apps/web even though this
// standalone script lives outside that package.
const requireFromWeb = NodeModule.createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);

async function importFromWeb(specifier) {
  return import(NodeURL.pathToFileURL(requireFromWeb.resolve(specifier)).href);
}

const [
  { createElement },
  { renderToStaticMarkup },
  { default: ReactMarkdown },
  { default: remarkGfm },
  { default: rehypeRaw },
  { default: rehypeSanitize, defaultSchema },
  { getSharedHighlighter },
] = await Promise.all([
  importFromWeb("react"),
  importFromWeb("react-dom/server"),
  importFromWeb("react-markdown"),
  importFromWeb("remark-gfm"),
  importFromWeb("rehype-raw"),
  importFromWeb("rehype-sanitize"),
  import(new URL("../apps/web/node_modules/@pierre/diffs/dist/index.js", import.meta.url)),
]);

// Keep this transformer byte-for-byte equivalent in behavior to the local
// transformer in ChatMarkdown.tsx. It is not exported from that component.
function remarkPreserveCodeMeta() {
  return (tree) => {
    const visit = (node) => {
      if (node.type === "code" && typeof node.meta === "string" && node.meta.trim().length > 0) {
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            dataCodeMeta: node.meta.trim(),
          },
        };
      }
      node.children?.forEach(visit);
    };

    visit(tree);
  };
}

// This is the ChatMarkdown.tsx schema, including fence metadata and file links.
const chatMarkdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": (defaultSchema.attributes?.["*"] ?? []).filter((attribute) => attribute !== "title"),
    code: [...(defaultSchema.attributes?.code ?? []), "dataCodeMeta"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "file"],
  },
};

const remarkPlugins = [remarkGfm, remarkNormalizeListItemIndentation, remarkPreserveCodeMeta];
const rehypePlugins = [rehypeRaw, [rehypeSanitize, chatMarkdownSanitizeSchema]];

const messagePrefix = `# Streaming render benchmark

This synthetic assistant message exercises **GFM**, ~~strikethrough~~, autolinks, raw HTML, and the
repo's list indentation recovery while a code fence is still being streamed.

- [x] Parse the growing transcript
-       Normalize an over-indented list item
- [ ] Keep the UI responsive

| Stage | Expected behavior |
| --- | --- |
| Markdown | Reparse and sanitize the full prefix |
| Code | Highlight the currently open fence |

<details><summary>Benchmark note</summary>Raw HTML is passed through rehype-raw and then sanitized.</details>

`;
const codeFenceOpen = '```typescript title="streaming-example.ts"\n';
const messageSuffix = "\n```\n";
const codePattern = `export function accumulateDelta(value: number, index: number) {
  const weighted = value * (index + 1);
  return { index, weighted, label: \`delta-\${index}\` };
}

const rendered = samples.map((value, index) => accumulateDelta(value, index));
`;

// Structurally varied so each repetition adds several block-level nodes
// (heading, paragraph, list, blockquote, table row) rather than one long
// paragraph. Growth therefore increases the node count the parser, rehype-raw
// serialization and sanitizer must walk, which is what an incremental renderer
// would avoid re-doing.
const prosePattern = `## Section heading for the streaming corpus

The assistant explains a change to \`applyThreadDetailEvent\` and links to
[the reducer](file:///repo/packages/client-runtime/src/state/threadReducer.ts) so the
reader can follow along. This paragraph carries *emphasis*, **strong emphasis**, and
~~a retraction~~ so the GFM plugin has real work to do.

- A bullet describing the first consequence
- A bullet with \`inline code\` and a trailing clause
- A bullet that runs long enough to wrap in a narrow transcript column

> A blockquote summarizing the tradeoff being described above.

`;

function buildMessage(finalSize) {
  if (PROSE_MODE) {
    const fillLength = finalSize - messagePrefix.length;
    if (fillLength < 0) {
      throw new Error(`Final size ${finalSize} is too small for the benchmark fixture.`);
    }
    const repeats = Math.ceil(fillLength / prosePattern.length);
    const prose = prosePattern.repeat(repeats).slice(0, fillLength);
    const message = messagePrefix + prose;
    if (message.length !== finalSize) {
      throw new Error(`Generated ${message.length} chars instead of ${finalSize}.`);
    }
    return message;
  }

  const fillLength = finalSize - messagePrefix.length - codeFenceOpen.length - messageSuffix.length;
  if (fillLength < 0) {
    throw new Error(`Final size ${finalSize} is too small for the benchmark fixture.`);
  }

  const repeats = Math.ceil(fillLength / codePattern.length);
  const code = codePattern.repeat(repeats).slice(0, fillLength);
  const message = messagePrefix + codeFenceOpen + code + messageSuffix;
  if (message.length !== finalSize) {
    throw new Error(`Generated ${message.length} chars instead of ${finalSize}.`);
  }
  return message;
}

function findOpenFence(markdown) {
  const lines = markdown.split("\n");
  let openFence = null;
  let codeStart = 0;
  let offset = 0;

  for (const line of lines) {
    if (openFence) {
      const closingMatch = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (
        closingMatch &&
        closingMatch[1][0] === openFence.marker &&
        closingMatch[1].length >= openFence.length
      ) {
        openFence = null;
      }
    } else {
      const openingMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (openingMatch) {
        const markerRun = openingMatch[1];
        const info = openingMatch[2].trim();
        // Backtick fence info strings cannot themselves contain a backtick.
        if (markerRun[0] === "~" || !info.includes("`")) {
          const rawLanguage = info.split(/\s+/, 1)[0] || "text";
          openFence = {
            marker: markerRun[0],
            length: markerRun.length,
            language: rawLanguage === "gitignore" ? "ini" : rawLanguage,
          };
          codeStart = offset + line.length + 1;
        }
      }
    }
    offset += line.length + 1;
  }

  return openFence
    ? {
        code: markdown.slice(codeStart),
        language: openFence.language,
      }
    : null;
}

function renderMarkdown(markdown) {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins, rehypePlugins }, markdown),
  );
}

function percentile(samples, quantile) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * quantile) - 1];
}

function summarize(samples) {
  return {
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    total: samples.reduce((sum, sample) => sum + sample, 0),
  };
}

function formatMs(milliseconds) {
  return milliseconds.toFixed(2);
}

function formatSize(size) {
  return size >= 1_000 ? `${size / 1_000}k` : String(size);
}

function printComponentTable(results) {
  console.log("## Component cost");
  console.log("");
  console.log(
    "| Final size | Deltas | Markdown p50 | Markdown p95 | Markdown total | Shiki p50 | Shiki p95 | Shiki total |",
  );
  console.log("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const result of results) {
    console.log(
      `| ${formatSize(result.finalSize)} | ${result.deltas} | ${formatMs(result.markdown.p50)} ms | ${formatMs(result.markdown.p95)} ms | ${formatMs(result.markdown.total)} ms | ${formatMs(result.shiki.p50)} ms | ${formatMs(result.shiki.p95)} ms | ${formatMs(result.shiki.total)} ms |`,
    );
  }
}

function printModeTable(results) {
  console.log("");
  console.log("## Streaming mode comparison");
  console.log("");
  console.log(
    "| Final size | Highlighted p50 | Highlighted p95 | Highlighted total | Plain p50 | Plain p95 | Plain total | Plain saves |",
  );
  console.log("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const result of results) {
    const savingsPercent =
      result.highlighted.total === 0 ? 0 : (result.shiki.total / result.highlighted.total) * 100;
    console.log(
      `| ${formatSize(result.finalSize)} | ${formatMs(result.highlighted.p50)} ms | ${formatMs(result.highlighted.p95)} ms | ${formatMs(result.highlighted.total)} ms | ${formatMs(result.plain.p50)} ms | ${formatMs(result.plain.p95)} ms | ${formatMs(result.plain.total)} ms | ${formatMs(result.shiki.total)} ms (${savingsPercent.toFixed(1)}%) |`,
    );
  }
}

const highlighter = await getSharedHighlighter({
  themes: ["pierre-dark", "pierre-light"],
  langs: ["typescript"],
  preferredHighlighter: "shiki-js",
});

// Exclude module loading, grammar/theme initialization, and first-call JIT
// effects. The measured workload is only steady-state per-delta rendering.
for (let iteration = 0; iteration < 3; iteration += 1) {
  renderMarkdown(buildMessage(1_000).slice(0, 600 + iteration * DELTA_CHARS));
  highlighter.codeToHtml(codePattern.slice(0, 200 + iteration * DELTA_CHARS), {
    lang: "typescript",
    theme: "pierre-dark",
  });
}

let outputLengthSink = 0;
const results = [];

for (const finalSize of FINAL_SIZES) {
  const message = buildMessage(finalSize);
  const markdownSamples = [];
  const shikiSamples = [];

  for (let end = DELTA_CHARS; end < message.length + DELTA_CHARS; end += DELTA_CHARS) {
    const prefix = message.slice(0, Math.min(end, message.length));

    const markdownStart = NodePerfHooks.performance.now();
    const markdownHtml = renderMarkdown(prefix);
    const markdownMs = NodePerfHooks.performance.now() - markdownStart;
    outputLengthSink ^= markdownHtml.length;

    const openFence = findOpenFence(prefix);
    let shikiMs = 0;
    if (!PLAIN_MODE && openFence) {
      const shikiStart = NodePerfHooks.performance.now();
      const highlightedHtml = highlighter.codeToHtml(openFence.code, {
        lang: openFence.language,
        theme: "pierre-dark",
      });
      shikiMs = NodePerfHooks.performance.now() - shikiStart;
      outputLengthSink ^= highlightedHtml.length;
    }

    markdownSamples.push(markdownMs);
    shikiSamples.push(shikiMs);
  }

  // In plain mode, keep codeToHtml completely outside the streaming replay.
  // This shadow pass exists only to quantify the work the shipped fix avoids.
  if (PLAIN_MODE) {
    for (let end = DELTA_CHARS, index = 0; end < message.length + DELTA_CHARS; end += DELTA_CHARS) {
      const prefix = message.slice(0, Math.min(end, message.length));
      const openFence = findOpenFence(prefix);
      if (openFence) {
        const shikiStart = NodePerfHooks.performance.now();
        const highlightedHtml = highlighter.codeToHtml(openFence.code, {
          lang: openFence.language,
          theme: "pierre-dark",
        });
        shikiSamples[index] = NodePerfHooks.performance.now() - shikiStart;
        outputLengthSink ^= highlightedHtml.length;
      }
      index += 1;
    }
  }

  const highlightedSamples = markdownSamples.map(
    (markdownMs, index) => markdownMs + shikiSamples[index],
  );
  results.push({
    finalSize,
    deltas: markdownSamples.length,
    markdown: summarize(markdownSamples),
    shiki: summarize(shikiSamples),
    highlighted: summarize(highlightedSamples),
    plain: summarize(markdownSamples),
  });
}

console.log(`# Streaming transcript render benchmark`);
console.log("");
console.log(
  `Mode: **${PLAIN_MODE ? "plain" : "highlighted"}**. Corpus: **${PROSE_MODE ? "prose (no fence)" : "code-filled fence"}**. Node ${process.version}; ${DELTA_CHARS}-char deltas; Shiki initialization excluded.`,
);
if (PLAIN_MODE) {
  console.log(
    "Shiki is timed as a separate comparison probe and excluded from the selected plain streaming cost.",
  );
}
console.log("");
printComponentTable(results);
printModeTable(results);

const highlightedTotal = results.reduce((sum, result) => sum + result.highlighted.total, 0);
const plainTotal = results.reduce((sum, result) => sum + result.plain.total, 0);
const savedTotal = highlightedTotal - plainTotal;
console.log("");
console.log(
  `Across the four independent replays, plain streaming saves **${formatMs(savedTotal)} ms** (${((savedTotal / highlightedTotal) * 100).toFixed(1)}%) of measured render work.`,
);

// Keep both generated outputs observable to the runtime without polluting the report.
void outputLengthSink;
