// @effect-diagnostics nodeBuiltinImport:off - Mirrors the Codex companion plugin's own
// sync fs/path layout logic so the two implementations stay diffable against each other.
/**
 * Reads the on-disk progress artifacts written by the Codex companion plugin
 * (`codex-companion.mjs`) for detached background jobs.
 *
 * Why this exists: when a Claude thread delegates to the `codex:codex-rescue`
 * subagent, that subagent is a thin forwarder — it makes one Bash call, gets
 * back a job id, and exits in ~30s while the real Codex work runs for minutes
 * in a *detached* process. Nothing from that process streams back through the
 * Claude SDK, so the Agents panel shows a single `Bash` row and then silence.
 *
 * The companion is already fully instrumented; it just writes to disk instead
 * of to a socket. Per job it maintains:
 *   - `<jobsDir>/<jobId>.json` — status/phase/title, phase updated only on change
 *   - `<jobsDir>/<jobId>.log`  — timestamped human-readable progress lines
 *
 * This module locates those files and turns the log into activity entries.
 */

import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/** Mirrors `state.mjs`'s `JOBS_DIR_NAME`. */
const JOBS_DIR_NAME = "jobs";

/**
 * Matches the launch confirmation the companion prints for a background task
 * (`codex-companion.mjs:557`). The rescue subagent is instructed to return that
 * stdout verbatim, so the job id reaches us inside the Bash tool result.
 *
 * The id is `<prefix>-<base36 time>-<base36 random>` (`state.mjs:124`), so `.`
 * is excluded from the class — otherwise the sentence's trailing period gets
 * absorbed into the id and every subsequent file lookup misses.
 */
const LAUNCHED_JOB_PATTERN = /started in the background as ([A-Za-z0-9_-]+)/;

/** `appendLogLine` prefixes every progress line with an ISO timestamp. */
const LOG_LINE_PATTERN = /^\[([^\]]+)\]\s*(.+)$/;

export type CodexCompanionJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface CodexCompanionJobRecord {
  readonly id: string;
  readonly status: CodexCompanionJobStatus;
  /** `investigating | editing | running | verifying | reviewing | finalizing | ...` */
  readonly phase: string | undefined;
  readonly title: string | undefined;
  readonly startedAt: string | undefined;
  /** Codex's final answer, present once the job settles. */
  readonly result: string | undefined;
}

export interface CodexCompanionProgressLine {
  readonly at: string;
  readonly message: string;
  /** Absent means unknown, not success — matches `ThreadAgentActivityEntry`. */
  readonly outcome: "ok" | "error" | undefined;
}

export interface CodexCompanionProgressRead {
  readonly lines: readonly CodexCompanionProgressLine[];
  readonly nextOffset: number;
  /** Identity of the file just read, to detect same-size replacement. */
  readonly inode: number | undefined;
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"]);

export const isTerminalCompanionStatus = (status: string): boolean => TERMINAL_STATUSES.has(status);

/**
 * Extracts the background job id from a Bash tool result, if the command was a
 * companion task launch. Returns undefined for every other tool result.
 */
export const parseLaunchedCodexJobId = (text: string): string | undefined => {
  const match = LAUNCHED_JOB_PATTERN.exec(text);
  return match?.[1];
};

/**
 * Mirrors the companion's `resolveWorkspaceRoot`, which keys its state dir on
 * `git rev-parse --show-toplevel` and falls back to the cwd outside a repo.
 *
 * Walking up for `.git` avoids spawning git on every lookup. A worktree's
 * `.git` is a file rather than a directory, so this checks for existence only.
 */
const gitWorkspaceRoot = (cwd: string): string => {
  let current = NodePath.resolve(cwd);
  for (;;) {
    if (NodeFS.existsSync(NodePath.join(current, ".git"))) {
      return current;
    }
    const parent = NodePath.dirname(current);
    if (parent === current) {
      return cwd;
    }
    current = parent;
  }
};

/**
 * Reimplements `state.mjs`'s `resolveStateDir` naming so the server can find
 * the job store without inheriting the plugin's `CLAUDE_PLUGIN_DATA` env var.
 *
 * Note the asymmetry, which is load-bearing: the slug comes from the *given*
 * path but the hash comes from the *realpath*. Windows separator differences
 * wash out because `realpathSync.native` normalises them the same way the
 * companion's own call does.
 */
const companionStateDirName = (workspaceRoot: string): string => {
  let canonical = workspaceRoot;
  try {
    canonical = NodeFS.realpathSync.native(workspaceRoot);
  } catch {
    canonical = workspaceRoot;
  }

  const slugSource = NodePath.basename(workspaceRoot) || "workspace";
  const slug = slugSource.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const hash = NodeCrypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  return `${slug}-${hash}`;
};

/**
 * Every directory that could hold companion state dirs.
 *
 * `resolveStateDir` keys off `CLAUDE_PLUGIN_DATA` and *silently* falls back to
 * a tmpdir when it is unset. The server process does not inherit that variable,
 * so shelling out to `codex-companion.mjs status` from here would look in the
 * wrong place and confidently report zero jobs. Scanning candidate roots and
 * matching on the workspace hash avoids depending on the variable at all, and
 * also avoids hardcoding the plugin's marketplace-qualified directory name.
 */
const companionStateRoots = (): readonly string[] => {
  const roots: string[] = [];

  const pluginData = process.env.CLAUDE_PLUGIN_DATA;
  if (pluginData) {
    roots.push(NodePath.join(pluginData, "state"));
  }

  const configDir = process.env.CLAUDE_CONFIG_DIR ?? NodePath.join(NodeOS.homedir(), ".claude");
  const dataDir = NodePath.join(configDir, "plugins", "data");
  try {
    for (const entry of NodeFS.readdirSync(dataDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        roots.push(NodePath.join(dataDir, entry.name, "state"));
      }
    }
  } catch {
    // No plugin data directory; fall through to the tmpdir fallback.
  }

  roots.push(NodePath.join(NodeOS.tmpdir(), "codex-companion"));
  return roots;
};

/**
 * Locates the companion `jobs/` directory for a workspace, or undefined when
 * the companion has never run there.
 */
export const resolveCompanionJobsDir = (cwd: string): string | undefined => {
  const dirName = companionStateDirName(gitWorkspaceRoot(cwd));
  for (const root of companionStateRoots()) {
    const candidate = NodePath.join(root, dirName, JOBS_DIR_NAME);
    try {
      if (NodeFS.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // Missing candidate; keep looking.
    }
  }
  return undefined;
};

const readStatus = (value: unknown): CodexCompanionJobStatus => {
  switch (value) {
    case "queued":
    case "running":
    case "completed":
    case "failed":
    case "cancelled":
      return value;
    default:
      return "running";
  }
};

const readOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

export const readCompanionJobRecord = (
  jobsDir: string,
  jobId: string,
): CodexCompanionJobRecord | undefined => {
  let raw: string;
  try {
    raw = NodeFS.readFileSync(NodePath.join(jobsDir, `${jobId}.json`), "utf8");
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The worker rewrites this file in place, so a poll can catch a torn write.
    return undefined;
  }

  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }

  const record = parsed as Record<string, unknown>;
  // `rendered` is the human-facing form the companion prints; `result.rawOutput`
  // is the same text before rendering. Prefer the former, fall back to the latter.
  const result = record.result as Record<string, unknown> | undefined;
  return {
    id: readOptionalString(record.id) ?? jobId,
    status: readStatus(record.status),
    phase: readOptionalString(record.phase),
    title: readOptionalString(record.title),
    startedAt: readOptionalString(record.startedAt) ?? readOptionalString(record.createdAt),
    result:
      readOptionalString(record.rendered) ??
      (result && typeof result === "object" ? readOptionalString(result.rawOutput) : undefined),
  };
};

/**
 * Classifies a progress line for the activity feed's health signal.
 *
 * Deliberately conservative: only an explicit `(exit 0)` counts as success, so
 * an unrecognised line stays unknown rather than being reported as fine.
 */
export const classifyProgressOutcome = (message: string): "ok" | "error" | undefined => {
  const exitMatch = /\(exit (\d+)\)/.exec(message);
  if (exitMatch) {
    return exitMatch[1] === "0" ? "ok" : "error";
  }
  if (/^(?:codex error|failed)\b/i.test(message)) {
    return "error";
  }
  if (/^command failed\b/i.test(message)) {
    return "error";
  }
  return undefined;
};

const parseProgressLine = (line: string): CodexCompanionProgressLine | undefined => {
  const match = LOG_LINE_PATTERN.exec(line);
  if (!match) {
    // `appendLogBlock` writes untimestamped body lines for verbose dumps
    // (command output, diffs). Skipping them keeps the feed to the one-line
    // progress messages the companion emits per Codex item event.
    return undefined;
  }

  const at = match[1] ?? "";
  const message = (match[2] ?? "").trim();
  if (message.length === 0) {
    return undefined;
  }

  return { at, message, outcome: classifyProgressOutcome(message) };
};

/**
 * Reads progress lines appended since `offset`.
 *
 * Byte-offset based so a long-running job's growing log is not re-read on every
 * poll. A partial trailing line (the worker appends while we read) is left for
 * the next call rather than being parsed half-written.
 */
export const readCompanionProgressSince = (
  jobsDir: string,
  jobId: string,
  offset: number,
  previousInode?: number,
): CodexCompanionProgressRead => {
  const logFile = NodePath.join(jobsDir, `${jobId}.log`);

  let size: number;
  let inode: number;
  try {
    const stats = NodeFS.statSync(logFile);
    size = stats.size;
    inode = Number(stats.ino);
  } catch {
    return { lines: [], nextOffset: offset, inode: previousInode };
  }

  // Detect replacement by identity, not by size. Comparing sizes only catches
  // a *shrinking* file: a fresh log that happens to be at least as long as the
  // old offset would otherwise resume mid-file and silently skip everything
  // before it. The companion deletes and recreates logs (its SessionEnd hook
  // unlinks them), so this is a real case, not a theoretical one.
  const replaced =
    size < offset || (previousInode !== undefined && inode !== 0 && inode !== previousInode);
  const start = replaced ? 0 : offset;
  if (size === start) {
    return { lines: [], nextOffset: start, inode };
  }

  const length = size - start;
  const buffer = Buffer.alloc(length);
  let bytesRead = 0;
  let fd: number | undefined;
  try {
    fd = NodeFS.openSync(logFile, "r");
    bytesRead = NodeFS.readSync(fd, buffer, 0, length, start);
  } catch {
    return { lines: [], nextOffset: offset, inode: previousInode };
  } finally {
    if (fd !== undefined) {
      try {
        NodeFS.closeSync(fd);
      } catch {
        // Best effort.
      }
    }
  }

  const chunk = buffer.subarray(0, bytesRead).toString("utf8");
  const lastNewline = chunk.lastIndexOf("\n");
  if (lastNewline < 0) {
    return { lines: [], nextOffset: start, inode };
  }

  const complete = chunk.slice(0, lastNewline);
  const consumed = Buffer.byteLength(complete, "utf8") + 1;

  const lines: CodexCompanionProgressLine[] = [];
  for (const line of complete.split("\n")) {
    const parsed = parseProgressLine(line);
    if (parsed) {
      lines.push(parsed);
    }
  }

  return { lines, nextOffset: start + consumed, inode };
};
