import { useAtomValue } from "@effect/atom-react";
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  GlobeIcon,
  Maximize2Icon,
  Minimize2Icon,
  WrapTextIcon,
} from "lucide-react";
import type { ScopedThreadRef, ServerProviderSkill } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import React, {
  Children,
  Suspense,
  type ClipboardEvent as ReactClipboardEvent,
  type MouseEvent as ReactMouseEvent,
  createContext,
  isValidElement,
  use,
  useCallback,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Components, Options as ReactMarkdownOptions } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { renderSkillInlineMarkdownChildren } from "./chat/SkillInlineText";
import { CHAT_FILE_TAG_CHIP_CLASS_NAME, FileTagChipContent } from "./chat/FileTagChip";
import { PierreEntryIcon } from "./chat/PierreEntryIcon";
import {
  resolveExternalWebLinkHost,
  showExternalLinkContextMenu,
} from "./chat/externalLinkContextMenu";
import { hasSpecificPierreIconForFileName, syntheticFileNameForLanguageId } from "../pierre-icons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { Button } from "./ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import { ScrollArea } from "./ui/scroll-area";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { useOpenInPreferredEditor, useRevealPath } from "../editorPreferences";
import { resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering";
import { fnv1a32 } from "../lib/diffRendering";
import { LRUCache } from "../lib/lruCache";
import { getSyntaxHighlighterPromise } from "../lib/syntaxHighlighting";
import { RenderErrorBoundary } from "./RenderErrorBoundary";
import { useTheme } from "../hooks/useTheme";
import { getClientSettings } from "../hooks/useSettings";
import {
  chatMarkdownClipboardPayload,
  serializeTableElementToCsv,
  serializeTableElementToMarkdown,
} from "../markdown-clipboard";
import { remarkNormalizeListItemIndentation } from "../markdown-list-indentation";
import {
  planIncrementalMarkdownSplit,
  type IncrementalMarkdownSplit,
} from "../markdown-incremental";
import {
  type MarkdownFileLinkMeta,
  normalizeMarkdownLinkDestination,
  resolveMarkdownFileLinkMeta,
  rewriteMarkdownFileUriHref,
} from "../markdown-links";
import { readLocalApi } from "../localApi";
import { cn } from "../lib/utils";
import { useRightPanelStore } from "../rightPanelStore";
import { useActiveEnvironmentId } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { assetEnvironment } from "../state/assets";
import { usePreparedConnection } from "../state/session";
import { previewEnvironment } from "../state/preview";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { isPreviewSupportedInRuntime } from "../previewStateStore";
import {
  isBrowserPreviewFile,
  openFileInPreview,
  openUrlInPreview,
  BrowserPreviewUnavailableError,
} from "../browser/openFileInPreview";
import { revealInFileExplorerLabel } from "./preview/fileExplorerLabel";

interface ChatMarkdownProps {
  text: string;
  cwd: string | undefined;
  threadRef?: ScopedThreadRef | undefined;
  onTaskListChange?: ((input: { markerOffset: number; checked: boolean }) => void) | undefined;
  isStreaming?: boolean;
  skills?: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  className?: string;
  /** Treat single newlines as hard breaks — chat-style user input. */
  lineBreaks?: boolean;
  /**
   * Append the live-response caret hook as the final child so a violet caret
   * can track the growth point at the end of the last streamed text block. The
   * caller drives this off the timeline lifecycle ledger's live-edge state; the
   * visible caret is a CSS `::after` on the preceding block (see
   * `conversation.css`), so the hook element itself stays invisible.
   */
  streamingCaret?: boolean;
}

const EMPTY_MARKDOWN_SKILLS: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">> = [];

const CODE_FENCE_LANGUAGE_REGEX = /(?:^|\s)language-([^\s]+)/;
const MAX_HIGHLIGHT_CACHE_ENTRIES = 500;
const MAX_HIGHLIGHT_CACHE_MEMORY_BYTES = 50 * 1024 * 1024;

interface MarkdownActionFailureContext {
  readonly operation: string;
  readonly target?: string;
  readonly format?: "markdown" | "csv";
  readonly language?: string;
  readonly fenceTitle?: string;
  readonly copyTarget?: string;
}

function reportMarkdownActionFailure(context: MarkdownActionFailureContext, cause: unknown): void {
  console.error("[chat-markdown] action failed", context, cause);
}

const highlightedCodeCache = new LRUCache<string>(
  MAX_HIGHLIGHT_CACHE_ENTRIES,
  MAX_HIGHLIGHT_CACHE_MEMORY_BYTES,
);

function findTaskListMarkerOffset(markdown: string, listItemStart: number): number | null {
  const firstLineEnd = markdown.indexOf("\n", listItemStart);
  const firstLine = markdown.slice(
    listItemStart,
    firstLineEnd === -1 ? markdown.length : firstLineEnd,
  );
  const match = firstLine.match(/^(?:\s*(?:[-+*]|\d+[.)])\s+)(\[[ xX]\])/);
  if (!match?.[1]) return null;
  return listItemStart + firstLine.indexOf(match[1]);
}
const CHAT_MARKDOWN_SANITIZE_SCHEMA = {
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
} satisfies Parameters<typeof rehypeSanitize>[0];

const CHAT_MARKDOWN_REMARK_PLUGINS = [
  remarkGfm,
  remarkNormalizeListItemIndentation,
  remarkPreserveCodeMeta,
] satisfies NonNullable<ReactMarkdownOptions["remarkPlugins"]>;

const CHAT_MARKDOWN_REMARK_PLUGINS_WITH_BREAKS = [
  remarkGfm,
  remarkNormalizeListItemIndentation,
  remarkBreaks,
  remarkPreserveCodeMeta,
] satisfies NonNullable<ReactMarkdownOptions["remarkPlugins"]>;

const CHAT_MARKDOWN_REHYPE_PLUGINS = [
  rehypeRaw,
  [rehypeSanitize, CHAT_MARKDOWN_SANITIZE_SCHEMA],
] satisfies NonNullable<ReactMarkdownOptions["rehypePlugins"]>;

const EMPTY_AVAILABLE_EDITORS = [] as const;
const EMPTY_FILE_LINK_META_BY_HREF: ReadonlyMap<string, MarkdownFileLinkMeta> = new Map();

/**
 * Which slice of the original message the surrounding `<ReactMarkdown>` was
 * given. Streaming messages are rendered as several independently parsed
 * chunks, so mdast offsets are chunk-relative; components that need an offset
 * into the *message* resolve it against this scope.
 */
interface MarkdownSourceScope {
  readonly source: string;
  readonly offset: number;
}

const MarkdownSourceScopeContext = createContext<MarkdownSourceScope | null>(null);

function taskListMarkerOffsetInScope(
  scope: MarkdownSourceScope | null,
  listItemStart: number | undefined,
): number | undefined {
  if (scope === null || typeof listItemStart !== "number") return undefined;
  // The marker always sits on the list item's own first line, which is fully
  // contained in the chunk, so resolving inside the chunk and shifting by the
  // chunk offset is identical to resolving against the whole message.
  const markerOffset = findTaskListMarkerOffset(scope.source, listItemStart);
  return markerOffset === null ? undefined : markerOffset + scope.offset;
}

interface MarkdownSegmentProps {
  readonly source: string;
  readonly offset: number;
  /**
   * `mdast-util-to-hast` puts a "\n" text node *between* every pair of
   * root-level blocks. Splitting the document drops the one that straddles the
   * cut, so every chunk but the last re-emits it and the concatenated DOM stays
   * node-for-node identical to a whole-document render.
   */
  readonly trailingSeparator: boolean;
  readonly components: Components;
  readonly remarkPlugins: NonNullable<ReactMarkdownOptions["remarkPlugins"]>;
  readonly rehypePlugins: NonNullable<ReactMarkdownOptions["rehypePlugins"]>;
  readonly urlTransform: NonNullable<ReactMarkdownOptions["urlTransform"]>;
}

/**
 * One independently parsed chunk of a message. `react-markdown` has no internal
 * memoization and builds a fresh unified processor on every render, so this
 * `memo` boundary is the entire point of the incremental path: frozen chunks
 * keep referentially stable props and are never re-parsed as the message grows.
 */
const MarkdownSegment = memo(function MarkdownSegment({
  source,
  offset,
  trailingSeparator,
  components,
  remarkPlugins,
  rehypePlugins,
  urlTransform,
}: MarkdownSegmentProps) {
  const scope = useMemo<MarkdownSourceScope>(() => ({ source, offset }), [source, offset]);
  return (
    <MarkdownSourceScopeContext value={scope}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
        urlTransform={urlTransform}
      >
        {source}
      </ReactMarkdown>
      {trailingSeparator ? "\n" : null}
    </MarkdownSourceScopeContext>
  );
});

function extractFenceLanguage(className: string | undefined): string {
  const match = className?.match(CODE_FENCE_LANGUAGE_REGEX);
  const raw = match?.[1] ?? "text";
  // Shiki doesn't bundle a gitignore grammar; ini is a close match (#685)
  return raw === "gitignore" ? "ini" : raw;
}

const FENCE_TITLE_ATTR_REGEX = /(?:^|\s)(?:title|file(?:name)?)=(?:"([^"]+)"|'([^']+)'|(\S+))/i;
const FENCE_FILENAME_TOKEN_REGEX = /^[\w@][\w@./-]*\.[A-Za-z0-9]+$/;

/** Pulls a filename out of fence meta: ```ts title="x.ts" / ```ts src/main.ts */
function extractFenceTitle(meta: string | undefined): string | null {
  if (!meta) return null;
  const attrMatch = FENCE_TITLE_ATTR_REGEX.exec(meta);
  const attrTitle = attrMatch?.[1] ?? attrMatch?.[2] ?? attrMatch?.[3];
  if (attrTitle) return attrTitle;
  return meta.split(/\s+/).find((candidate) => FENCE_FILENAME_TOKEN_REGEX.test(candidate)) ?? null;
}

function extractPreCodeMeta(node: unknown): string | undefined {
  const children = (
    node as
      | {
          children?: Array<{
            type?: string;
            tagName?: string;
            data?: { meta?: unknown };
            properties?: { dataCodeMeta?: unknown };
          }>;
        }
      | undefined
  )?.children;
  const codeNode = children?.find((child) => child?.type === "element" && child.tagName === "code");
  const meta = codeNode?.properties?.dataCodeMeta ?? codeNode?.data?.meta;
  return typeof meta === "string" && meta.trim().length > 0 ? meta.trim() : undefined;
}

type MarkdownAstNode = {
  type?: string;
  meta?: unknown;
  data?: {
    hProperties?: Record<string, unknown>;
  };
  children?: MarkdownAstNode[];
};

function remarkPreserveCodeMeta() {
  return (tree: MarkdownAstNode) => {
    const visit = (node: MarkdownAstNode) => {
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

function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => nodeToPlainText(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeToPlainText(node.props.children);
  }
  return "";
}

function extractCodeBlock(
  children: ReactNode,
): { className: string | undefined; code: string } | null {
  const childNodes = Children.toArray(children);
  if (childNodes.length !== 1) {
    return null;
  }

  const onlyChild = childNodes[0];
  if (
    !isValidElement<{ className?: string; children?: ReactNode }>(onlyChild) ||
    onlyChild.type !== "code"
  ) {
    return null;
  }

  return {
    className: onlyChild.props.className,
    code: nodeToPlainText(onlyChild.props.children),
  };
}

function createHighlightCacheKey(code: string, language: string, themeName: DiffThemeName): string {
  return `${fnv1a32(code).toString(36)}:${code.length}:${language}:${themeName}`;
}

function estimateHighlightedSize(html: string, code: string): number {
  return Math.max(html.length * 2, code.length * 3);
}

function readInitialWordWrapSetting(): boolean {
  return getClientSettings().wordWrap;
}

function MarkdownTable({ children, ...props }: React.ComponentProps<"table">) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [expanded, setExpanded] = useState(readInitialWordWrapSetting);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandLabel = expanded ? "Collapse table cells" : "Expand table cells";
  const copyLabel = copied ? "Copied" : "Copy table";

  function toggleExpanded() {
    const table = tableRef.current;
    if (!table) return;

    if (!expanded) {
      const rows = [...table.rows];
      const columnWidths = rows.reduce<number[]>((widths, row) => {
        [...row.cells].forEach((cell, columnIndex) => {
          widths[columnIndex] = Math.max(
            widths[columnIndex] ?? 0,
            cell.getBoundingClientRect().width,
          );
        });
        return widths;
      }, []);

      [...(table.tHead?.rows[0]?.cells ?? [])].forEach((cell, columnIndex) => {
        cell.style.minWidth = `${columnWidths[columnIndex] ?? cell.getBoundingClientRect().width}px`;
      });
    }

    setExpanded((value) => !value);
  }

  const handleCopy = useCallback((format: "markdown" | "csv") => {
    const table = containerRef.current?.querySelector("table");
    if (!table || typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }
    const text =
      format === "markdown"
        ? serializeTableElementToMarkdown(table)
        : serializeTableElementToCsv(table);
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current);
        }
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1200);
      })
      .catch((cause) => {
        reportMarkdownActionFailure({ operation: "copy-table", format }, cause);
      });
  }, []);

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className="chat-markdown-table-container"
      data-expanded={expanded ? "true" : "false"}
    >
      <ScrollArea
        chainVerticalScroll
        scrollFade
        hideScrollbars
        className="w-full max-w-full rounded-none"
      >
        <table ref={tableRef} {...props}>
          {children}
        </table>
      </ScrollArea>
      <div className="chat-markdown-table-footer select-none">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="chat-markdown-chrome-action"
                aria-pressed={expanded}
                onClick={toggleExpanded}
                aria-label={expandLabel}
              />
            }
          >
            {expanded ? <Minimize2Icon className="size-3" /> : <Maximize2Icon className="size-3" />}
          </TooltipTrigger>
          <TooltipPopup side="top">{expandLabel}</TooltipPopup>
        </Tooltip>
        <Menu>
          <Tooltip>
            <TooltipTrigger
              render={
                <MenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="chat-markdown-chrome-action"
                      aria-label={copyLabel}
                    />
                  }
                />
              }
            >
              {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            </TooltipTrigger>
            <TooltipPopup side="top">{copyLabel}</TooltipPopup>
          </Tooltip>
          <MenuPopup align="end">
            <MenuItem onClick={() => handleCopy("markdown")}>Copy as Markdown</MenuItem>
            <MenuItem onClick={() => handleCopy("csv")}>Copy as CSV</MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
}

function MarkdownDetails({
  children,
  open = false,
}: Pick<React.ComponentProps<"details">, "children" | "open">) {
  const [isOpen, setIsOpen] = useState(open);
  const childNodes = Children.toArray(children);
  const summaryIndex = childNodes.findIndex(
    (child) => isValidElement(child) && child.type === "summary",
  );
  const summaryNode = summaryIndex >= 0 ? childNodes[summaryIndex] : null;
  const summary =
    isValidElement<{ children?: ReactNode }>(summaryNode) && summaryNode.props.children
      ? summaryNode.props.children
      : "Details";
  const content = childNodes.filter((_, index) => index !== summaryIndex);

  return (
    <Collapsible
      defaultOpen={open}
      onOpenChange={setIsOpen}
      className="chat-markdown-details my-2 border-y border-border/60"
      data-markdown-details=""
      data-markdown-details-open={isOpen ? "true" : "false"}
    >
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 py-2 text-left text-sm font-medium text-foreground data-panel-open:[&_svg]:rotate-90"
        data-markdown-details-summary=""
      >
        <ChevronRightIcon
          className="size-4 shrink-0 text-muted-foreground transition-transform"
          aria-hidden
        />
        <span>{summary}</span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="pb-3 ps-6 text-foreground/80" data-markdown-details-content="">
          {content}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/**
 * Filename titles render icon + text; language-only titles render just the
 * icon (redundant next to its own name) and fall back to the language text
 * when no specific icon exists or it fails to load.
 */
function MarkdownCodeBlockTitleContent({
  fenceTitle,
  language,
  theme,
}: {
  fenceTitle: string | null;
  language: string;
  theme: "light" | "dark";
}) {
  if (fenceTitle) {
    return (
      <>
        <PierreEntryIcon pathValue={fenceTitle} kind="file" theme={theme} className="size-3.5" />
        <span className="truncate">{fenceTitle}</span>
      </>
    );
  }

  const fileName = syntheticFileNameForLanguageId(language);
  if (!hasSpecificPierreIconForFileName(fileName)) {
    return <span className="truncate">{language}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex shrink-0 rounded-sm" aria-label={`Language: ${language}`} />
        }
      >
        <PierreEntryIcon pathValue={fileName} kind="file" theme={theme} className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">{language}</TooltipPopup>
    </Tooltip>
  );
}

function MarkdownCodeBlock({
  code,
  language,
  fenceTitle,
  theme,
  children,
}: {
  code: string;
  language: string;
  fenceTitle: string | null;
  theme: "light" | "dark";
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [wrapped, setWrapped] = useState(readInitialWordWrapSetting);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapLabel = wrapped ? "Disable line wrap" : "Wrap lines";
  const copyLabel = copied ? "Copied" : "Copy code";

  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current);
        }
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1200);
      })
      .catch((cause) => {
        reportMarkdownActionFailure(
          {
            operation: "copy-code-block",
            language,
            ...(fenceTitle ? { fenceTitle } : {}),
          },
          cause,
        );
      });
  }, [code, fenceTitle, language]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    },
    [],
  );

  return (
    <div
      className="chat-markdown-codeblock leading-snug"
      data-language={language}
      data-wrap={wrapped ? "true" : "false"}
    >
      <div className="chat-markdown-codeblock-header select-none">
        <span className="chat-markdown-codeblock-title">
          <MarkdownCodeBlockTitleContent
            fenceTitle={fenceTitle}
            language={language}
            theme={theme}
          />
        </span>
        <span className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="chat-markdown-chrome-action"
                  aria-pressed={wrapped}
                  onClick={() => setWrapped((value) => !value)}
                  aria-label={wrapLabel}
                />
              }
            >
              <WrapTextIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">{wrapLabel}</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="chat-markdown-chrome-action"
                  onClick={handleCopy}
                  aria-label={copyLabel}
                />
              }
            >
              {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            </TooltipTrigger>
            <TooltipPopup side="top">{copyLabel}</TooltipPopup>
          </Tooltip>
        </span>
      </div>
      {children}
    </div>
  );
}

interface SuspenseShikiCodeBlockProps {
  className: string | undefined;
  code: string;
  themeName: DiffThemeName;
  isStreaming: boolean;
}

function SuspenseShikiCodeBlock({
  className,
  code,
  themeName,
  isStreaming,
}: SuspenseShikiCodeBlockProps) {
  const language = extractFenceLanguage(className);
  if (isStreaming) {
    return <PlainStreamingCodeBlock className={className} code={code} />;
  }

  const cacheKey = createHighlightCacheKey(code, language, themeName);
  const cachedHighlightedHtml = highlightedCodeCache.get(cacheKey);

  if (cachedHighlightedHtml != null) {
    return (
      <div
        className="chat-markdown-shiki"
        dangerouslySetInnerHTML={{ __html: cachedHighlightedHtml }}
      />
    );
  }

  return (
    <UncachedShikiCodeBlock
      code={code}
      language={language}
      themeName={themeName}
      cacheKey={cacheKey}
    />
  );
}

function PlainStreamingCodeBlock({
  className,
  code,
}: {
  className: string | undefined;
  code: string;
}) {
  return (
    <pre>
      <code className={className}>{code}</code>
    </pre>
  );
}

interface UncachedShikiCodeBlockProps {
  code: string;
  language: string;
  themeName: DiffThemeName;
  cacheKey: string;
}

function UncachedShikiCodeBlock({
  code,
  language,
  themeName,
  cacheKey,
}: UncachedShikiCodeBlockProps) {
  const highlighter = use(getSyntaxHighlighterPromise(language));
  const highlightedHtml = useMemo(() => {
    try {
      return highlighter.codeToHtml(code, { lang: language, theme: themeName });
    } catch (error) {
      // Log highlighting failures for debugging while falling back to plain text
      console.warn(
        `Code highlighting failed for language "${language}", falling back to plain text.`,
        error instanceof Error ? error.message : error,
      );
      // If highlighting fails for this language, render as plain text
      return highlighter.codeToHtml(code, { lang: "text", theme: themeName });
    }
  }, [code, highlighter, language, themeName]);

  useEffect(() => {
    highlightedCodeCache.set(
      cacheKey,
      highlightedHtml,
      estimateHighlightedSize(highlightedHtml, code),
    );
  }, [cacheKey, code, highlightedHtml]);

  return (
    <div className="chat-markdown-shiki" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
  );
}

interface MarkdownFileLinkProps {
  href: string;
  meta: MarkdownFileLinkMeta;
  iconPath: string;
  label: string;
  copyMarkdown: string;
  theme: "light" | "dark";
  threadRef?: ScopedThreadRef | undefined;
  onOpen: (targetPath: string) => Promise<AtomCommandResult<unknown, unknown>>;
  onOpenInBrowser?: (() => Promise<AtomCommandResult<unknown, unknown>>) | undefined;
  onReveal?: ((targetPath: string) => Promise<AtomCommandResult<unknown, unknown>>) | undefined;
  revealLabel?: string | undefined;
  className?: string | undefined;
}

interface MarkdownProseFileLinkProps {
  meta: MarkdownFileLinkMeta;
  children: ReactNode;
  copyMarkdown: string;
  threadRef?: ScopedThreadRef | undefined;
  onOpen: (targetPath: string) => Promise<AtomCommandResult<unknown, unknown>>;
  onOpenInBrowser?: (() => Promise<AtomCommandResult<unknown, unknown>>) | undefined;
  onReveal?: ((targetPath: string) => Promise<AtomCommandResult<unknown, unknown>>) | undefined;
  revealLabel?: string | undefined;
  anchorProps: React.AnchorHTMLAttributes<HTMLAnchorElement>;
}

const MARKDOWN_LINK_HREF_PATTERN = /\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
const MARKDOWN_FILE_LINK_CLASS_NAME =
  "chat-markdown-file-link cursor-pointer transition-colors text-astro-highlight hover:text-astro-highlight/80";

/** Chip variant: the accent also tints its existing surface and border on hover. */
const MARKDOWN_FILE_LINK_CHIP_CLASS_NAME =
  "hover:border-astro-highlight/40 hover:bg-astro-highlight/12";

/** Prose variant: inline text, so it takes the dotted underline instead of a surface. */
const MARKDOWN_FILE_LINK_PROSE_CLASS_NAME = "chat-markdown-file-link-prose";

function pathParentSegments(path: string): string[] {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments.slice(0, -1);
}

function buildFileLinkParentSuffixByPath(filePaths: ReadonlyArray<string>): Map<string, string> {
  const groups = new Map<string, Set<string>>();
  for (const filePath of filePaths) {
    const pathSegments = filePath
      .replaceAll("\\", "/")
      .split("/")
      .filter((segment) => segment.length > 0);
    const basename = pathSegments[pathSegments.length - 1];
    if (!basename) continue;
    const group = groups.get(basename) ?? new Set<string>();
    group.add(filePath);
    groups.set(basename, group);
  }

  const suffixByPath = new Map<string, string>();
  for (const group of groups.values()) {
    const uniquePaths = [...group];
    if (uniquePaths.length < 2) continue;

    const parentSegmentsByPath = new Map(
      uniquePaths.map((filePath) => [filePath, pathParentSegments(filePath)]),
    );
    const minUniqueDepthByPath = new Map<string, number>();

    for (const filePath of uniquePaths) {
      const segments = parentSegmentsByPath.get(filePath) ?? [];
      let resolvedDepth = segments.length;
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const candidate = segments.slice(-depth).join("/");
        const collision = uniquePaths.some((otherPath) => {
          if (otherPath === filePath) return false;
          const otherSegments = parentSegmentsByPath.get(otherPath) ?? [];
          return otherSegments.slice(-depth).join("/") === candidate;
        });
        if (!collision) {
          resolvedDepth = depth;
          break;
        }
      }
      minUniqueDepthByPath.set(filePath, resolvedDepth);
    }

    for (const filePath of uniquePaths) {
      const segments = parentSegmentsByPath.get(filePath) ?? [];
      if (segments.length === 0) continue;
      const minUniqueDepth = minUniqueDepthByPath.get(filePath) ?? 1;
      const suffixDepth = Math.min(segments.length, Math.max(minUniqueDepth, 2));
      suffixByPath.set(filePath, segments.slice(-suffixDepth).join("/"));
    }
  }

  return suffixByPath;
}

function extractMarkdownLinkHrefs(text: string): string[] {
  const hrefs: string[] = [];
  for (const match of text.matchAll(MARKDOWN_LINK_HREF_PATTERN)) {
    const href = match[1]?.trim();
    if (!href) continue;
    hrefs.push(href);
  }
  return hrefs;
}

function normalizeMarkdownLinkHrefKey(href: string): string {
  const normalizedHref = normalizeMarkdownLinkDestination(href);
  return rewriteMarkdownFileUriHref(normalizedHref) ?? normalizedHref;
}

function isLiveFileLinkCandidate(href: string): boolean {
  return href.length > 0 && !href.startsWith("#") && !/^(?:https?:|mailto:)/i.test(href);
}

function comparableMarkdownPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

function isPathLikeMarkdownLinkLabel(
  label: string | null,
  normalizedHref: string,
  meta: MarkdownFileLinkMeta,
  cwd: string | undefined,
): boolean {
  const normalizedLabel = label?.trim();
  if (!normalizedLabel) return false;

  const labelHref = normalizeMarkdownLinkHrefKey(normalizedLabel);
  const comparableLabel = comparableMarkdownPath(labelHref);
  const candidates = [
    normalizedHref,
    meta.targetPath,
    meta.filePath,
    meta.displayPath,
    meta.basename,
  ].map(comparableMarkdownPath);
  if (candidates.includes(comparableLabel)) return true;

  const labelWithoutPosition = normalizedLabel.replace(/:\d+(?::\d+)?$/, "");
  if (labelWithoutPosition === meta.basename) return true;

  const labelMeta = resolveMarkdownFileLinkMeta(labelHref, cwd);
  return (
    labelMeta !== null &&
    comparableMarkdownPath(labelMeta.filePath) === comparableMarkdownPath(meta.filePath)
  );
}

const MARKDOWN_LINK_FAVICON_CLASS_NAME = "block size-full shrink-0 select-none";

/** Hosts whose favicon request already failed this session — skip straight to the globe. */
const failedFaviconHosts = new Set<string>();

const MarkdownLinkFavicon = memo(function MarkdownLinkFavicon({ host }: { host: string }) {
  const [failedHost, setFailedHost] = useState<string | null>(null);
  return (
    <span className="chat-markdown-link-favicon" aria-hidden>
      {failedHost === host || failedFaviconHosts.has(host) ? (
        <GlobeIcon className={MARKDOWN_LINK_FAVICON_CLASS_NAME} />
      ) : (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
          alt=""
          loading="lazy"
          draggable={false}
          className={cn(MARKDOWN_LINK_FAVICON_CLASS_NAME, "rounded-sm")}
          onError={() => {
            failedFaviconHosts.add(host);
            setFailedHost(host);
          }}
        />
      )}
    </span>
  );
});

function leadingExternalLinkTextLength(text: string): number {
  const protocol = /^(?:https?:\/\/)/i.exec(text)?.[0];
  if (protocol) return protocol.length;
  return Math.min(text.length, 1);
}

function breakableExternalLinkText(text: string): ReactNode[] {
  return Array.from(text, (character, index) => (
    <React.Fragment key={`${index}:${character}`}>
      {character}
      <wbr />
    </React.Fragment>
  ));
}

function plainHastText(node: unknown): string | null {
  if (!node || typeof node !== "object" || !("children" in node) || !Array.isArray(node.children)) {
    return null;
  }
  const parts = node.children.map((child) => {
    if (
      child &&
      typeof child === "object" &&
      "type" in child &&
      child.type === "text" &&
      "value" in child &&
      typeof child.value === "string"
    ) {
      return child.value;
    }
    return null;
  });
  return parts.every((part) => part !== null) ? parts.join("") : null;
}

function hastTextContent(node: unknown): string | null {
  if (!node || typeof node !== "object" || !("type" in node)) return null;
  if (node.type === "text" && "value" in node && typeof node.value === "string") {
    return node.value;
  }
  if (!("children" in node) || !Array.isArray(node.children)) return null;
  const parts = node.children.map(hastTextContent);
  return parts.every((part) => part !== null) ? parts.join("") : null;
}

const SANITIZED_FRAGMENT_PREFIX = "user-content-";

function decodeMarkdownFragmentId(href: string): string {
  const encodedId = href.slice(1);
  try {
    return decodeURIComponent(encodedId);
  } catch {
    return encodedId;
  }
}

function normalizeSanitizedFragmentId(id: string): string {
  let normalizedId = id;
  while (normalizedId.startsWith(SANITIZED_FRAGMENT_PREFIX)) {
    normalizedId = normalizedId.slice(SANITIZED_FRAGMENT_PREFIX.length);
  }
  return normalizedId;
}

function findMarkdownFragmentTarget(anchor: HTMLAnchorElement, href: string): HTMLElement | null {
  const decodedId = decodeMarkdownFragmentId(href);
  const normalizedId = normalizeSanitizedFragmentId(decodedId);
  const matchesFragment = (element: HTMLElement) =>
    element.id === decodedId || normalizeSanitizedFragmentId(element.id) === normalizedId;
  const markdownRoot = anchor.closest<HTMLElement>(".chat-markdown");
  if (markdownRoot) {
    const localTargets = Array.from(markdownRoot.querySelectorAll<HTMLElement>("[id]"));
    const localTarget = localTargets.find(matchesFragment);
    if (localTarget) return localTarget;
  }

  return (
    document.getElementById(decodedId) ??
    Array.from(document.querySelectorAll<HTMLElement>("[id]")).find(matchesFragment) ??
    null
  );
}

function handleMarkdownFragmentClick(event: ReactMouseEvent<HTMLAnchorElement>, href: string) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  const target = findMarkdownFragmentTarget(event.currentTarget, href);
  if (!target) return;

  event.preventDefault();
  const nextUrl = new URL(window.location.href);
  nextUrl.hash = href.slice(1);
  window.history.pushState(window.history.state, "", nextUrl);
  target.scrollIntoView({ block: "nearest" });
}

function MarkdownExternalLinkContent({
  host,
  plainText,
  children,
}: {
  host: string;
  plainText: string | null;
  children: ReactNode;
}) {
  if (plainText) {
    const leadingLength = leadingExternalLinkTextLength(plainText);
    return (
      <>
        <span className="chat-markdown-link-leading">
          <MarkdownLinkFavicon host={host} />
          {plainText.slice(0, leadingLength)}
        </span>
        {breakableExternalLinkText(plainText.slice(leadingLength))}
      </>
    );
  }

  const childNodes = Children.toArray(children);
  const firstChild = childNodes[0];

  if (typeof firstChild === "string" && firstChild.length > 0) {
    const leadingLength = leadingExternalLinkTextLength(firstChild);
    return (
      <>
        <span className="chat-markdown-link-leading">
          <MarkdownLinkFavicon host={host} />
          {firstChild.slice(0, leadingLength)}
        </span>
        {breakableExternalLinkText(firstChild.slice(leadingLength))}
        {childNodes.slice(1)}
      </>
    );
  }

  return (
    <>
      <span className="chat-markdown-link-leading">
        <MarkdownLinkFavicon host={host} />
        {firstChild}
      </span>
      {childNodes.slice(1)}
    </>
  );
}

function useMarkdownFileLinkActions(
  meta: MarkdownFileLinkMeta,
  options: {
    threadRef?: ScopedThreadRef | undefined;
    onOpen: (targetPath: string) => Promise<AtomCommandResult<unknown, unknown>>;
    onOpenInBrowser?: (() => Promise<AtomCommandResult<unknown, unknown>>) | undefined;
    onReveal?: ((targetPath: string) => Promise<AtomCommandResult<unknown, unknown>>) | undefined;
    revealLabel?: string | undefined;
  },
) {
  const { threadRef, onOpen, onOpenInBrowser, onReveal, revealLabel } = options;
  const { targetPath, workspaceRelativePath, line, displayPath } = meta;
  const handleOpenInEditor = useCallback(() => {
    void (async () => {
      try {
        const result = await onOpen(targetPath);
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
          return;
        }
        reportMarkdownActionFailure(
          { operation: "open-file-in-editor", target: targetPath },
          result.cause,
        );
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open file",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      } catch (cause) {
        reportMarkdownActionFailure(
          { operation: "open-file-in-editor", target: targetPath },
          cause,
        );
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open file",
            description: cause instanceof Error ? cause.message : "An error occurred.",
          }),
        );
      }
    })();
  }, [onOpen, targetPath]);

  const handleOpenInFilePreview = useCallback(() => {
    if (!threadRef || !workspaceRelativePath) {
      handleOpenInEditor();
      return;
    }
    useRightPanelStore.getState().openFile(threadRef, workspaceRelativePath, line);
  }, [handleOpenInEditor, line, threadRef, workspaceRelativePath]);

  const handleOpenInBrowser = useCallback(() => {
    if (!onOpenInBrowser) {
      return;
    }
    void (async () => {
      try {
        const result = await onOpenInBrowser();
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
          return;
        }
        reportMarkdownActionFailure(
          { operation: "open-file-in-browser", target: targetPath },
          result.cause,
        );
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open file in browser",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      } catch (cause) {
        reportMarkdownActionFailure(
          { operation: "open-file-in-browser", target: targetPath },
          cause,
        );
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open file in browser",
            description: cause instanceof Error ? cause.message : "An error occurred.",
          }),
        );
      }
    })();
  }, [onOpenInBrowser, targetPath]);

  const handleReveal = useCallback(() => {
    if (!onReveal) {
      return;
    }
    void (async () => {
      try {
        const result = await onReveal(targetPath);
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
          return;
        }
        reportMarkdownActionFailure({ operation: "reveal-file", target: targetPath }, result.cause);
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to reveal file",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      } catch (cause) {
        reportMarkdownActionFailure({ operation: "reveal-file", target: targetPath }, cause);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to reveal file",
            description: cause instanceof Error ? cause.message : "An error occurred.",
          }),
        );
      }
    })();
  }, [onReveal, targetPath]);

  const handleCopy = useCallback(
    (value: string, title: string) => {
      if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Failed to copy ${title.toLowerCase()}`,
            description: "Clipboard API unavailable.",
          }),
        );
        return;
      }

      void navigator.clipboard.writeText(value).then(
        () => {
          toastManager.add({
            type: "success",
            title: `${title} copied`,
            description: value,
          });
        },
        (error) => {
          reportMarkdownActionFailure(
            { operation: "copy-file-path", target: targetPath, copyTarget: title },
            error,
          );
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: `Failed to copy ${title.toLowerCase()}`,
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        },
      );
    },
    [targetPath],
  );

  const handleContextMenu = useCallback(
    async (event: ReactMouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const api = readLocalApi();
      if (!api) return;

      try {
        const clicked = await api.contextMenu.show(
          [
            { id: "open", label: "Open in editor" },
            ...(onReveal
              ? ([{ id: "reveal", label: revealLabel ?? "Open in File Manager" }] as const)
              : []),
            ...(onOpenInBrowser
              ? ([{ id: "open-in-browser", label: "Open in integrated browser" }] as const)
              : []),
            { id: "copy-relative", label: "Copy relative path" },
            { id: "copy-full", label: "Copy full path" },
          ] as const,
          { x: event.clientX, y: event.clientY },
        );

        if (clicked === "open") {
          handleOpenInEditor();
          return;
        }
        if (clicked === "reveal") {
          handleReveal();
          return;
        }
        if (clicked === "open-in-browser") {
          handleOpenInBrowser();
          return;
        }
        if (clicked === "copy-relative") {
          handleCopy(displayPath, "Relative path");
          return;
        }
        if (clicked === "copy-full") {
          handleCopy(targetPath, "Full path");
        }
      } catch (cause) {
        reportMarkdownActionFailure(
          { operation: "show-file-context-menu", target: targetPath },
          cause,
        );
      }
    },
    [
      displayPath,
      handleCopy,
      handleOpenInBrowser,
      handleOpenInEditor,
      handleReveal,
      onOpenInBrowser,
      onReveal,
      revealLabel,
      targetPath,
    ],
  );

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (onOpenInBrowser) {
        handleOpenInBrowser();
        return;
      }
      handleOpenInFilePreview();
    },
    [handleOpenInBrowser, handleOpenInFilePreview, onOpenInBrowser],
  );

  return {
    onClick: handleClick,
    onContextMenu: handleContextMenu,
  };
}

const MarkdownFileLink = memo(function MarkdownFileLink({
  href,
  meta,
  iconPath,
  label,
  copyMarkdown,
  theme,
  threadRef,
  onOpen,
  onOpenInBrowser,
  onReveal,
  revealLabel,
  className,
}: MarkdownFileLinkProps) {
  const actions = useMarkdownFileLinkActions(meta, {
    threadRef,
    onOpen,
    onOpenInBrowser,
    onReveal,
    revealLabel,
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={href}
            className={cn(
              CHAT_FILE_TAG_CHIP_CLASS_NAME,
              MARKDOWN_FILE_LINK_CLASS_NAME,
              MARKDOWN_FILE_LINK_CHIP_CLASS_NAME,
              className,
            )}
            data-markdown-copy={copyMarkdown}
            onClick={actions.onClick}
            onContextMenu={actions.onContextMenu}
          >
            <FileTagChipContent path={iconPath} label={label} theme={theme} selectable />
          </a>
        }
      />
      <TooltipPopup
        side="top"
        className="max-w-[min(40rem,calc(100vw-2rem))] font-mono text-[11px] leading-tight"
      >
        <div className="markdown-file-link-tooltip-scroll overflow-x-auto whitespace-nowrap">
          {meta.displayPath}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}, areMarkdownFileLinkPropsEqual);

const MarkdownProseFileLink = memo(function MarkdownProseFileLink({
  meta,
  children,
  copyMarkdown,
  threadRef,
  onOpen,
  onOpenInBrowser,
  onReveal,
  revealLabel,
  anchorProps,
}: MarkdownProseFileLinkProps) {
  const actions = useMarkdownFileLinkActions(meta, {
    threadRef,
    onOpen,
    onOpenInBrowser,
    onReveal,
    revealLabel,
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            {...anchorProps}
            className={cn(
              MARKDOWN_FILE_LINK_CLASS_NAME,
              MARKDOWN_FILE_LINK_PROSE_CLASS_NAME,
              anchorProps.className,
            )}
            href={meta.targetPath}
            target={undefined}
            rel={undefined}
            data-markdown-copy={copyMarkdown}
            onClick={actions.onClick}
            onContextMenu={actions.onContextMenu}
          >
            {children}
          </a>
        }
      />
      <TooltipPopup
        side="top"
        className="max-w-[min(40rem,calc(100vw-2rem))] font-mono text-[11px] leading-tight"
      >
        <div className="markdown-file-link-tooltip-scroll overflow-x-auto whitespace-nowrap">
          {meta.targetPath}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
});

function areMarkdownFileLinkPropsEqual(
  previous: Readonly<MarkdownFileLinkProps>,
  next: Readonly<MarkdownFileLinkProps>,
): boolean {
  return (
    previous.href === next.href &&
    previous.meta.targetPath === next.meta.targetPath &&
    previous.meta.filePath === next.meta.filePath &&
    previous.meta.displayPath === next.meta.displayPath &&
    previous.meta.workspaceRelativePath === next.meta.workspaceRelativePath &&
    previous.meta.line === next.meta.line &&
    previous.iconPath === next.iconPath &&
    previous.label === next.label &&
    previous.copyMarkdown === next.copyMarkdown &&
    previous.theme === next.theme &&
    previous.threadRef === next.threadRef &&
    previous.onOpen === next.onOpen &&
    previous.onOpenInBrowser === next.onOpenInBrowser &&
    previous.onReveal === next.onReveal &&
    previous.revealLabel === next.revealLabel &&
    previous.className === next.className
  );
}

function ChatMarkdown({
  text,
  cwd,
  threadRef,
  onTaskListChange,
  isStreaming = false,
  skills = EMPTY_MARKDOWN_SKILLS,
  className,
  lineBreaks = false,
  streamingCaret = false,
}: ChatMarkdownProps) {
  const { resolvedTheme } = useTheme();
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
  });
  const openPreview = useAtomCommand(previewEnvironment.open, {
    reportFailure: false,
  });
  const preparedConnection = usePreparedConnection(threadRef?.environmentId ?? null);
  const environmentId = useActiveEnvironmentId();
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const openInPreferredEditor = useOpenInPreferredEditor(
    environmentId,
    // A fresh `[]` literal here would re-create the callback on every render and
    // defeat the memoized streaming segments below.
    serverConfig?.availableEditors ?? EMPTY_AVAILABLE_EDITORS,
  );
  const revealPath = useRevealPath(environmentId);
  // Deliberately not gated on the `file-manager` editor being probed as
  // available: revealing is its own RPC, and a missing probe should surface as
  // an error toast rather than silently removing the menu item.
  const revealLabel = revealInFileExplorerLabel(
    serverConfig?.environment.platform.os ??
      (typeof navigator === "undefined" ? "" : navigator.platform),
  );
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  // While the message is still streaming, re-parsing the whole accumulated text
  // on every delta is quadratic. `planIncrementalMarkdownSplit` refuses unless
  // it can prove a block boundary is safe, so `null` is the normal, correct
  // outcome and simply means "render the whole string exactly as before".
  const split = useMemo<IncrementalMarkdownSplit | null>(
    () => (isStreaming ? planIncrementalMarkdownSplit(text) : null),
    [isStreaming, text],
  );
  const resolvedFileLinkMetaByHref = useMemo(() => {
    const metaByHref = new Map<
      string,
      NonNullable<ReturnType<typeof resolveMarkdownFileLinkMeta>>
    >();
    for (const href of extractMarkdownLinkHrefs(text)) {
      const normalizedHref = normalizeMarkdownLinkHrefKey(href);
      if (metaByHref.has(normalizedHref)) continue;
      const meta = resolveMarkdownFileLinkMeta(normalizedHref, cwd);
      if (meta) {
        metaByHref.set(normalizedHref, meta);
      }
    }
    return metaByHref;
  }, [cwd, text]);
  // This map is only a lookup cache: `resolveMarkdownFileLinkMeta` is a pure
  // function of (href, cwd), it returns null for every href the link renderer
  // would not resolve live anyway, and the renderer already falls back to it on
  // a miss. Handing the split path a stable empty map is therefore
  // behaviour-preserving, and it keeps a map that grows with the message from
  // invalidating every frozen segment each time a new link streams in.
  const markdownFileLinkMetaByHref = split
    ? EMPTY_FILE_LINK_META_BY_HREF
    : resolvedFileLinkMetaByHref;
  // Parent-suffix disambiguation genuinely depends on every link in the message,
  // so it is recomputed on each delta. Routing it through a string signature
  // keeps the map's identity stable while its *contents* are unchanged — which
  // is nearly always, because a suffix only exists when two linked paths share
  // a basename.
  const fileLinkParentSuffixSignature = useMemo(() => {
    const filePaths = [...resolvedFileLinkMetaByHref.values()].map((meta) => meta.filePath);
    return JSON.stringify([...buildFileLinkParentSuffixByPath(filePaths)]);
  }, [resolvedFileLinkMetaByHref]);
  const fileLinkParentSuffixByPath = useMemo(
    () =>
      new Map<string, string>(
        JSON.parse(fileLinkParentSuffixSignature) as ReadonlyArray<[string, string]>,
      ),
    [fileLinkParentSuffixSignature],
  );
  const markdownUrlTransform = useCallback((href: string) => {
    return rewriteMarkdownFileUriHref(href) ?? defaultUrlTransform(href);
  }, []);
  // Re-emit highlighted content as markdown so copying out of the rendered
  // view keeps links, emphasis, lists, and code fences intact.
  const handleCopy = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !event.clipboardData) return;
    const payload = chatMarkdownClipboardPayload(selection);
    if (!payload) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", payload.text);
    event.clipboardData.setData("text/html", payload.html);
  }, []);
  const openExternalLinkInPreview = useCallback(
    (url: string) => {
      if (!threadRef) {
        return Promise.resolve(
          AsyncResult.failure<void, BrowserPreviewUnavailableError>(
            Cause.fail(
              new BrowserPreviewUnavailableError({
                message: "Thread context is unavailable.",
              }),
            ),
          ),
        );
      }
      return openUrlInPreview({ threadRef, url, openPreview });
    },
    [openPreview, threadRef],
  );
  const openMarkdownFileInPreview = useCallback(
    (path: string) => {
      if (!threadRef || preparedConnection._tag === "None") {
        return Promise.resolve(
          AsyncResult.failure<void, BrowserPreviewUnavailableError>(
            Cause.fail(
              new BrowserPreviewUnavailableError({
                message: "Environment is not connected.",
              }),
            ),
          ),
        );
      }
      return openFileInPreview({
        threadRef,
        filePath: path,
        httpBaseUrl: preparedConnection.value.httpBaseUrl,
        createAssetUrl,
        openPreview,
      });
    },
    [createAssetUrl, openPreview, preparedConnection, threadRef],
  );
  const markdownComponents = useMemo<Components>(
    () => ({
      p({ node: _node, children, ...props }) {
        return <p {...props}>{renderSkillInlineMarkdownChildren(children, skills)}</p>;
      },
      li({ node, children, ...props }) {
        const scope = use(MarkdownSourceScopeContext);
        return (
          <li
            {...props}
            data-task-marker-offset={taskListMarkerOffsetInScope(
              scope,
              node?.position?.start.offset,
            )}
          >
            {renderSkillInlineMarkdownChildren(children, skills)}
          </li>
        );
      },
      input({ node: _node, type, checked, disabled: _disabled, ...props }) {
        if (type !== "checkbox" || !onTaskListChange) {
          return (
            <input
              {...props}
              type={type}
              checked={checked}
              disabled={_disabled}
              readOnly={type === "checkbox"}
            />
          );
        }
        return (
          <input
            {...props}
            type="checkbox"
            name="markdown-task"
            aria-label="Toggle task"
            checked={checked}
            onChange={(event) => {
              const markerOffset = Number(
                event.currentTarget.closest("li")?.dataset.taskMarkerOffset,
              );
              if (!Number.isSafeInteger(markerOffset)) return;
              onTaskListChange({ markerOffset, checked: event.currentTarget.checked });
            }}
          />
        );
      },
      a({ node, href, children, ...props }) {
        const normalizedHref = href ? normalizeMarkdownLinkHrefKey(href) : "";
        const cachedFileLinkMeta = normalizedHref
          ? markdownFileLinkMetaByHref.get(normalizedHref)
          : undefined;
        const fileLinkMeta =
          cachedFileLinkMeta ??
          (isLiveFileLinkCandidate(normalizedHref)
            ? resolveMarkdownFileLinkMeta(normalizedHref, cwd)
            : null);
        if (!fileLinkMeta) {
          const faviconHost = resolveExternalWebLinkHost(href);
          const isSameDocumentLink = href?.startsWith("#") ?? false;
          const isHttpLink = /^https?:/i.test(href ?? "");
          const onClick = props.onClick;
          const canOpenInPreview = Boolean(threadRef) && isPreviewSupportedInRuntime();
          const link = (
            <a
              {...props}
              href={href}
              target={isHttpLink ? "_blank" : undefined}
              rel={isHttpLink ? "noopener noreferrer" : undefined}
              onClick={(event) => {
                onClick?.(event);
                if (isSameDocumentLink && href) {
                  handleMarkdownFragmentClick(event, href);
                  return;
                }
                if (!isHttpLink) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              onContextMenu={(event) => {
                if (!href) return;
                const api = readLocalApi();
                if (!api) return;
                if (!faviconHost || !canOpenInPreview) {
                  if (isHttpLink) return;
                  event.preventDefault();
                  event.stopPropagation();
                  void api.contextMenu
                    .show([{ id: "copy-link", label: "Copy Link" }] as const, {
                      x: event.clientX,
                      y: event.clientY,
                    })
                    .then((clicked) => {
                      if (clicked === "copy-link") {
                        return writeTextToClipboard(href, "link");
                      }
                    })
                    .catch((cause) => {
                      reportMarkdownActionFailure(
                        { operation: "show-link-context-menu", target: href },
                        cause,
                      );
                    });
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                void showExternalLinkContextMenu({
                  href,
                  position: { x: event.clientX, y: event.clientY },
                  showContextMenu: (items, position) => api.contextMenu.show(items, position),
                  openInPreview: async (target) => {
                    const result = await openExternalLinkInPreview(target);
                    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                      reportMarkdownActionFailure(
                        { operation: "open-link-in-preview", target },
                        result.cause,
                      );
                    }
                  },
                  openExternal: (target) => api.shell.openExternal(target),
                  copyLink: (target) => writeTextToClipboard(target, "link"),
                  reportFailure: (operation, cause) => {
                    reportMarkdownActionFailure({ operation, target: href }, cause);
                  },
                });
              }}
            >
              {faviconHost ? (
                <MarkdownExternalLinkContent host={faviconHost} plainText={plainHastText(node)}>
                  {children}
                </MarkdownExternalLinkContent>
              ) : (
                children
              )}
            </a>
          );
          if (!faviconHost || !href) {
            return link;
          }
          return (
            <Tooltip>
              <TooltipTrigger render={link} />
              <TooltipPopup
                side="top"
                className="max-w-[min(36rem,calc(100vw-2rem))] whitespace-normal leading-tight wrap-anywhere"
              >
                {href}
              </TooltipPopup>
            </Tooltip>
          );
        }

        const plainLabel = hastTextContent(node);
        const onOpenInBrowser =
          threadRef && isPreviewSupportedInRuntime() && isBrowserPreviewFile(fileLinkMeta.filePath)
            ? () => openMarkdownFileInPreview(fileLinkMeta.filePath)
            : undefined;
        const onReveal = revealPath;
        const copyMarkdown = `[${plainLabel ?? fileLinkMeta.basename}](${normalizedHref})`;
        if (!isPathLikeMarkdownLinkLabel(plainLabel, normalizedHref, fileLinkMeta, cwd)) {
          return (
            <MarkdownProseFileLink
              meta={fileLinkMeta}
              copyMarkdown={copyMarkdown}
              threadRef={threadRef}
              onOpen={openInPreferredEditor}
              onOpenInBrowser={onOpenInBrowser}
              onReveal={onReveal}
              revealLabel={revealLabel}
              anchorProps={props}
            >
              {children}
            </MarkdownProseFileLink>
          );
        }

        const parentSuffix = fileLinkParentSuffixByPath.get(fileLinkMeta.filePath);
        const labelParts = [fileLinkMeta.basename];
        if (typeof parentSuffix === "string" && parentSuffix.length > 0) {
          labelParts.push(parentSuffix);
        }
        if (fileLinkMeta.line) {
          labelParts.push(
            `L${fileLinkMeta.line}${fileLinkMeta.column ? `:C${fileLinkMeta.column}` : ""}`,
          );
        }

        return (
          <MarkdownFileLink
            href={fileLinkMeta.targetPath}
            meta={fileLinkMeta}
            iconPath={fileLinkMeta.filePath}
            label={labelParts.join(" · ")}
            copyMarkdown={copyMarkdown}
            theme={resolvedTheme}
            threadRef={threadRef}
            onOpen={openInPreferredEditor}
            onOpenInBrowser={onOpenInBrowser}
            onReveal={onReveal}
            revealLabel={revealLabel}
            className={props.className}
          />
        );
      },
      table({ node: _node, ...props }) {
        return <MarkdownTable {...props} />;
      },
      details({ node: _node, children, open: detailsOpen }) {
        return <MarkdownDetails open={detailsOpen}>{children}</MarkdownDetails>;
      },
      pre({ node, children, ...props }) {
        const codeBlock = extractCodeBlock(children);
        if (!codeBlock) {
          return <pre {...props}>{children}</pre>;
        }

        const language = extractFenceLanguage(codeBlock.className);
        const fenceTitle = extractFenceTitle(extractPreCodeMeta(node));
        return (
          <MarkdownCodeBlock
            code={codeBlock.code}
            language={language}
            fenceTitle={fenceTitle}
            theme={resolvedTheme}
          >
            <RenderErrorBoundary fallback={<pre {...props}>{children}</pre>}>
              <Suspense fallback={<pre {...props}>{children}</pre>}>
                <SuspenseShikiCodeBlock
                  className={codeBlock.className}
                  code={codeBlock.code}
                  themeName={diffThemeName}
                  isStreaming={isStreaming}
                />
              </Suspense>
            </RenderErrorBoundary>
          </MarkdownCodeBlock>
        );
      },
    }),
    [
      cwd,
      diffThemeName,
      fileLinkParentSuffixByPath,
      isStreaming,
      markdownFileLinkMetaByHref,
      onTaskListChange,
      openInPreferredEditor,
      openExternalLinkInPreview,
      openMarkdownFileInPreview,
      revealPath,
      revealLabel,
      resolvedTheme,
      skills,
      threadRef,
    ],
  );

  const remarkPlugins = lineBreaks
    ? CHAT_MARKDOWN_REMARK_PLUGINS_WITH_BREAKS
    : CHAT_MARKDOWN_REMARK_PLUGINS;

  return (
    <div
      className={cn(
        "chat-markdown w-full min-w-0 text-sm leading-relaxed text-foreground/80",
        className,
      )}
      onCopy={handleCopy}
    >
      {split?.segments.map((segment) => (
        <MarkdownSegment
          key={segment.offset}
          source={segment.source}
          offset={segment.offset}
          trailingSeparator
          components={markdownComponents}
          remarkPlugins={remarkPlugins}
          rehypePlugins={CHAT_MARKDOWN_REHYPE_PLUGINS}
          urlTransform={markdownUrlTransform}
        />
      ))}
      <MarkdownSegment
        source={split ? split.tail.source : text}
        offset={split ? split.tail.offset : 0}
        trailingSeparator={false}
        components={markdownComponents}
        remarkPlugins={remarkPlugins}
        rehypePlugins={CHAT_MARKDOWN_REHYPE_PLUGINS}
        urlTransform={markdownUrlTransform}
      />
      {streamingCaret ? <span className="conversation-live-caret" aria-hidden="true" /> : null}
    </div>
  );
}

export default memo(ChatMarkdown);
