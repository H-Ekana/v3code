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
const STATE_FILE_NAME = "state.json";
const WATCHER_REGISTRATION_SUFFIX = ".v3code-watcher.json";

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
  readonly updatedAt: string | undefined;
  /** Correlates the companion record to its Codex rollout transcript. */
  readonly threadId: string | undefined;
  /** Narrows abort evidence to this job's active turn. */
  readonly turnId: string | undefined;
  /** Worker PID is used only for read-only liveness checks, never process control. */
  readonly pid: number | undefined;
  readonly errorMessage: string | undefined;
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

export interface CodexCompanionWatcherRegistration {
  readonly threadId: string;
  readonly agentId: string;
  readonly jobId: string;
  readonly createdAt: string;
  readonly codexThreadId?: string;
  readonly codexTurnId?: string;
}

export interface CodexCompanionJobLookup {
  /**
   * `vanished` means a valid state store no longer contains the job. The
   * companion caps that list and deletes the corresponding per-job artifacts,
   * so this is terminal evidence rather than "still starting".
   */
  readonly storeStatus: "present" | "vanished" | "unavailable";
  readonly record: CodexCompanionJobRecord | undefined;
  /** Freshness evidence from state.json, the per-job record, and the log. */
  readonly latestArtifactMtimeMs: number | undefined;
  /** Per-job freshness; unrelated state.json writes must not mask silence. */
  readonly latestJobActivityMtimeMs: number | undefined;
}

export interface CodexCompanionAbortEvidence {
  readonly reason: string;
  readonly turnId: string | undefined;
  readonly completedAt: string | undefined;
  readonly durationMs: number | undefined;
  readonly rolloutPath: string;
}

export interface CodexCompanionAbortRead {
  readonly abort: CodexCompanionAbortEvidence | undefined;
  readonly rolloutPath: string | undefined;
  readonly nextOffset: number;
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
 * Every companion `jobs/` directory that exists for a workspace, in root
 * enumeration order.
 *
 * There can legitimately be more than one. The store path embeds the plugin's
 * *installation* directory (`plugins/data/<plugin>-<marketplace>/`), so the
 * bundled copy shipped with v3code writes to `codex-inline/` while a previously
 * installed marketplace copy wrote to `codex-openai-codex/`. Both stores can
 * hold jobs for the same workspace across an upgrade, and returning only the
 * first one makes every job in the other store structurally invisible.
 */
export const resolveCompanionJobsDirs = (cwd: string): readonly string[] => {
  const dirName = companionStateDirName(gitWorkspaceRoot(cwd));
  const dirs: string[] = [];
  const seen = new Set<string>();
  for (const root of companionStateRoots()) {
    const candidate = NodePath.resolve(NodePath.join(root, dirName, JOBS_DIR_NAME));
    try {
      if (!NodeFS.statSync(candidate).isDirectory()) {
        continue;
      }
    } catch {
      // Missing candidate; keep looking.
      continue;
    }
    // `CLAUDE_PLUGIN_DATA` frequently points at one of the scanned data dirs,
    // so the same store would otherwise be listed twice. Identity comes from
    // the realpath rather than a case fold, so two genuinely distinct stores on
    // a case-sensitive filesystem are never collapsed into one.
    let key = candidate;
    try {
      key = NodeFS.realpathSync.native(candidate);
    } catch {
      key = candidate;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    dirs.push(candidate);
  }
  return dirs;
};

/**
 * Locates the companion `jobs/` directory for a workspace, or undefined when
 * the companion has never run there.
 */
export const resolveCompanionJobsDir = (cwd: string): string | undefined =>
  resolveCompanionJobsDirs(cwd)[0];

/** True when this store owns `jobId`, by either of the companion's authorities. */
export const companionJobsDirHasJob = (jobsDir: string, jobId: string): boolean => {
  try {
    if (NodeFS.statSync(NodePath.join(jobsDir, `${jobId}.json`)).isFile()) {
      return true;
    }
  } catch {
    // Fall through to the capped summary list, which outlives per-job files.
  }

  try {
    const parsed: unknown = JSON.parse(
      NodeFS.readFileSync(NodePath.join(NodePath.dirname(jobsDir), STATE_FILE_NAME), "utf8"),
    );
    const jobs =
      parsed && typeof parsed === "object" ? (parsed as { jobs?: unknown }).jobs : undefined;
    if (!Array.isArray(jobs)) {
      return false;
    }
    return jobs.some(
      (candidate) =>
        candidate !== null &&
        typeof candidate === "object" &&
        readOptionalString((candidate as Record<string, unknown>).id) === jobId,
    );
  } catch {
    return false;
  }
};

/**
 * Picks the store that actually holds `jobId`.
 *
 * With two populated stores for one workspace, plain enumeration order decides
 * which one a watcher reads — and reading the wrong one reports a live job as
 * `vanished`. Selecting by job membership removes the ordering dependency
 * entirely. When no store claims the job (not written yet, or genuinely gone)
 * this falls back to the first store, which is exactly the pre-existing
 * single-store behaviour.
 */
export const resolveCompanionJobsDirForJob = (cwd: string, jobId: string): string | undefined => {
  const dirs = resolveCompanionJobsDirs(cwd);
  if (dirs.length <= 1) {
    return dirs[0];
  }
  for (const dir of dirs) {
    if (companionJobsDirHasJob(dir, jobId)) {
      return dir;
    }
  }
  return dirs[0];
};

/**
 * Environment variable the desktop packaging step sets to the directory of the
 * patched Codex companion plugin shipped inside the installed app.
 *
 * This name is a contract between `scripts/build-desktop-artifact.ts` and this
 * module; changing it silently disables the bundled plugin.
 */
export const BUNDLED_CODEX_PLUGIN_DIR_ENV = "T3CODE_BUNDLED_CODEX_PLUGIN_DIR";

/**
 * Marketplace-qualified id of the upstream install the bundled copy replaces.
 * A session that loads the bundled plugin must disable this one, or the
 * SessionEnd hook and every `/codex:*` skill would be registered twice.
 */
export const INSTALLED_CODEX_PLUGIN_ID = "codex@openai-codex";

/** Where the patched plugin is vendored in a source checkout. */
const VENDORED_CODEX_PLUGIN_SEGMENTS = ["vendor", "claude-plugins", "codex"] as const;

export interface BundledCodexPlugin {
  readonly dir: string;
  /** `env` = shipped with the installed app; `repo` = dev checkout fallback. */
  readonly source: "env" | "repo";
}

const isCodexPluginDir = (candidate: string): boolean => {
  try {
    return NodeFS.statSync(NodePath.join(candidate, ".claude-plugin", "plugin.json")).isFile();
  } catch {
    return false;
  }
};

/**
 * Resolves the directory of the Codex companion plugin bundled with v3code.
 *
 * Returns undefined when there is nothing to load, in which case session wiring
 * is a no-op and Claude sessions behave exactly as before.
 */
export const resolveBundledCodexPluginDir = (
  env: NodeJS.ProcessEnv = process.env,
  startDir: string = import.meta.dirname,
): BundledCodexPlugin | undefined => {
  const configured = env[BUNDLED_CODEX_PLUGIN_DIR_ENV]?.trim();
  if (configured) {
    // An explicitly configured path is authoritative. Falling back to a source
    // checkout that cannot exist inside a packaged app would only hide a
    // packaging bug behind "it works on the dev machine".
    const dir = NodePath.resolve(configured);
    return isCodexPluginDir(dir) ? { dir, source: "env" } : undefined;
  }

  let current = NodePath.resolve(startDir);
  for (;;) {
    const candidate = NodePath.join(current, ...VENDORED_CODEX_PLUGIN_SEGMENTS);
    if (isCodexPluginDir(candidate)) {
      return { dir: candidate, source: "repo" };
    }
    const parent = NodePath.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
};

const statMtimeMs = (filePath: string): number | undefined => {
  try {
    return NodeFS.statSync(filePath).mtimeMs;
  } catch {
    return undefined;
  }
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

const readOptionalNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const readOptionalPid = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;

const readCompanionJobRecordValue = (
  value: unknown,
  jobId: string,
): CodexCompanionJobRecord | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  // `rendered` is the human-facing form the companion prints; `result.rawOutput`
  // is the same text before rendering. Prefer the former, fall back to the latter.
  const result = record.result as Record<string, unknown> | undefined;
  return {
    id: readOptionalString(record.id) ?? jobId,
    status: readStatus(record.status),
    phase: readOptionalString(record.phase),
    title: readOptionalString(record.title),
    startedAt: readOptionalString(record.startedAt) ?? readOptionalString(record.createdAt),
    updatedAt: readOptionalString(record.updatedAt),
    threadId: readOptionalString(record.threadId),
    turnId: readOptionalString(record.turnId),
    pid: readOptionalPid(record.pid),
    errorMessage: readOptionalString(record.errorMessage),
    result:
      readOptionalString(record.rendered) ??
      (result && typeof result === "object" ? readOptionalString(result.rawOutput) : undefined),
  };
};

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

  return readCompanionJobRecordValue(parsed, jobId);
};

/**
 * Reads both authorities used by the companion: the capped `state.json` list
 * and the richer per-job file. A valid list that omits `jobId` is authoritative
 * evidence that the job vanished; a PID is deliberately never consulted.
 */
export const lookupCompanionJob = (jobsDir: string, jobId: string): CodexCompanionJobLookup => {
  const stateFile = NodePath.join(NodePath.dirname(jobsDir), STATE_FILE_NAME);
  const jobFile = NodePath.join(jobsDir, `${jobId}.json`);
  const logFile = NodePath.join(jobsDir, `${jobId}.log`);
  const mtimes = [stateFile, jobFile, logFile]
    .map(statMtimeMs)
    .filter((value): value is number => value !== undefined);
  const jobActivityMtimes = [jobFile, logFile]
    .map(statMtimeMs)
    .filter((value): value is number => value !== undefined);
  const latestArtifactMtimeMs = mtimes.length > 0 ? Math.max(...mtimes) : undefined;
  const latestJobActivityMtimeMs =
    jobActivityMtimes.length > 0 ? Math.max(...jobActivityMtimes) : undefined;

  let stateParsed: unknown;
  try {
    stateParsed = JSON.parse(NodeFS.readFileSync(stateFile, "utf8"));
  } catch {
    return {
      storeStatus: "unavailable",
      record: readCompanionJobRecord(jobsDir, jobId),
      latestArtifactMtimeMs,
      latestJobActivityMtimeMs,
    };
  }

  const jobs =
    stateParsed && typeof stateParsed === "object"
      ? (stateParsed as { jobs?: unknown }).jobs
      : undefined;
  if (!Array.isArray(jobs)) {
    return {
      storeStatus: "unavailable",
      record: readCompanionJobRecord(jobsDir, jobId),
      latestArtifactMtimeMs,
      latestJobActivityMtimeMs,
    };
  }

  const stateRecord = jobs.find(
    (candidate) =>
      candidate !== null &&
      typeof candidate === "object" &&
      readOptionalString((candidate as Record<string, unknown>).id) === jobId,
  );
  if (stateRecord === undefined) {
    return {
      storeStatus: "vanished",
      record: undefined,
      latestArtifactMtimeMs,
      latestJobActivityMtimeMs,
    };
  }

  const summaryRecord = readCompanionJobRecordValue(stateRecord, jobId);
  const detailedRecord = readCompanionJobRecord(jobsDir, jobId);
  // The worker writes the detailed file and summary store separately. If a
  // restart lands between those writes, either one may be newer; terminal is
  // monotonic, so preserve it from either artifact while retaining the richer
  // result from the per-job file.
  const record =
    summaryRecord &&
    detailedRecord &&
    isTerminalCompanionStatus(summaryRecord.status) &&
    !isTerminalCompanionStatus(detailedRecord.status)
      ? {
          ...detailedRecord,
          status: summaryRecord.status,
          phase: summaryRecord.phase ?? detailedRecord.phase,
        }
      : (detailedRecord ?? summaryRecord);

  return {
    storeStatus: "present",
    record,
    latestArtifactMtimeMs,
    latestJobActivityMtimeMs,
  };
};

const companionSessionsRoot = (): string =>
  NodePath.join(process.env.CODEX_HOME ?? NodePath.join(NodeOS.homedir(), ".codex"), "sessions");

const findRolloutPath = (sessionsRoot: string, threadId: string): string | undefined => {
  const suffix = "-" + threadId + ".jsonl";
  const pending = [sessionsRoot];

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) {
      continue;
    }
    let entries: readonly NodeFS.Dirent[];
    try {
      entries = NodeFS.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = NodePath.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(candidate);
      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
        return candidate;
      }
    }
  }
  return undefined;
};

const parseAbortLine = (
  line: string,
  record: CodexCompanionJobRecord,
  rolloutPath: string,
): CodexCompanionAbortEvidence | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const payload = (parsed as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const event = payload as Record<string, unknown>;
  if (event.type !== "turn_aborted") {
    return undefined;
  }
  const turnId = readOptionalString(event.turn_id);
  if (record.turnId && turnId !== record.turnId) {
    return undefined;
  }
  return {
    reason: readOptionalString(event.reason) ?? "interrupted",
    turnId,
    completedAt: readOptionalString(event.completed_at),
    durationMs: readOptionalNumber(event.duration_ms),
    rolloutPath,
  };
};

/**
 * Incrementally tails the Codex rollout correlated by the job's threadId.
 * Codex can persist turn_aborted before the killed worker marks its own record
 * failed, making the rollout the strongest available terminal evidence.
 */
export const readCompanionAbortSince = (
  record: CodexCompanionJobRecord,
  offset: number,
  previousRolloutPath?: string,
  previousInode?: number,
  sessionsRoot = companionSessionsRoot(),
): CodexCompanionAbortRead => {
  const rolloutPath =
    previousRolloutPath ??
    (record.threadId ? findRolloutPath(sessionsRoot, record.threadId) : undefined);
  if (!rolloutPath) {
    return {
      abort: undefined,
      rolloutPath: previousRolloutPath,
      nextOffset: offset,
      inode: previousInode,
    };
  }

  let size: number;
  let inode: number;
  try {
    const stats = NodeFS.statSync(rolloutPath);
    size = stats.size;
    inode = Number(stats.ino);
  } catch {
    return { abort: undefined, rolloutPath: undefined, nextOffset: 0, inode: undefined };
  }

  const replaced =
    size < offset || (previousInode !== undefined && inode !== 0 && inode !== previousInode);
  const start = replaced ? 0 : offset;
  if (size === start) {
    return { abort: undefined, rolloutPath, nextOffset: start, inode };
  }

  const length = size - start;
  const buffer = Buffer.alloc(length);
  let bytesRead = 0;
  let fd: number | undefined;
  try {
    fd = NodeFS.openSync(rolloutPath, "r");
    bytesRead = NodeFS.readSync(fd, buffer, 0, length, start);
  } catch {
    return { abort: undefined, rolloutPath, nextOffset: offset, inode: previousInode };
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
    return { abort: undefined, rolloutPath, nextOffset: start, inode };
  }
  const complete = chunk.slice(0, lastNewline);
  const consumed = Buffer.byteLength(complete, "utf8") + 1;
  for (const line of complete.split("\n")) {
    const abort = parseAbortLine(line, record, rolloutPath);
    if (abort) {
      return { abort, rolloutPath, nextOffset: start + consumed, inode };
    }
  }
  return { abort: undefined, rolloutPath, nextOffset: start + consumed, inode };
};

export const writeCompanionWatcherRegistration = (
  jobsDir: string,
  registration: CodexCompanionWatcherRegistration,
): void => {
  NodeFS.mkdirSync(jobsDir, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(jobsDir, `${registration.jobId}${WATCHER_REGISTRATION_SUFFIX}`),
    `${JSON.stringify(registration, null, 2)}\n`,
    "utf8",
  );
};

export const removeCompanionWatcherRegistration = (jobsDir: string, jobId: string): void => {
  try {
    NodeFS.unlinkSync(NodePath.join(jobsDir, jobId + WATCHER_REGISTRATION_SUFFIX));
  } catch {
    // Already absent or concurrently removed after terminal reconciliation.
  }
};

/**
 * Read-only liveness probe. A positive result is not identity proof because a
 * PID may have been recycled, so this result is never used for process control.
 */
export const isCompanionProcessRunning = (pid: number | undefined): boolean | undefined => {
  if (pid === undefined) {
    return undefined;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { readonly code?: unknown }).code
        : undefined;
    if (code === "ESRCH") {
      return false;
    }
    if (code === "EPERM") {
      return true;
    }
    return undefined;
  }
};

export const readCompanionWatcherRegistrations = (
  jobsDir: string,
  threadId: string,
): readonly CodexCompanionWatcherRegistration[] => {
  let entries: readonly string[];
  try {
    entries = NodeFS.readdirSync(jobsDir);
  } catch {
    return [];
  }

  const registrations: CodexCompanionWatcherRegistration[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(WATCHER_REGISTRATION_SUFFIX)) {
      continue;
    }
    try {
      const parsed = JSON.parse(
        NodeFS.readFileSync(NodePath.join(jobsDir, entry), "utf8"),
      ) as Partial<CodexCompanionWatcherRegistration>;
      if (
        parsed.threadId === threadId &&
        typeof parsed.agentId === "string" &&
        parsed.agentId.length > 0 &&
        typeof parsed.jobId === "string" &&
        parsed.jobId.length > 0 &&
        typeof parsed.createdAt === "string" &&
        (parsed.codexThreadId === undefined || typeof parsed.codexThreadId === "string") &&
        (parsed.codexTurnId === undefined || typeof parsed.codexTurnId === "string")
      ) {
        registrations.push({
          threadId: parsed.threadId,
          agentId: parsed.agentId,
          jobId: parsed.jobId,
          createdAt: parsed.createdAt,
          ...(parsed.codexThreadId ? { codexThreadId: parsed.codexThreadId } : {}),
          ...(parsed.codexTurnId ? { codexTurnId: parsed.codexTurnId } : {}),
        });
      }
    } catch {
      // A concurrent/crashed write is not a reason to stop reconciling the
      // remaining registrations.
    }
  }
  return registrations;
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
