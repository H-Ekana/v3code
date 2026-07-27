#!/usr/bin/env node
/**
 * Snapshots the installed desktop app's live state directory into a scratch
 * home so a dev build can be pointed at real threads.
 *
 * Why a snapshot rather than `--home-dir ~/.t3` directly: the server runs
 * `runMigrations()` unconditionally on every database open
 * (apps/server/src/persistence/Sqlite.ts), and this repo has no down
 * migrations. A dev branch one migration ahead of the installed build would
 * permanently rewrite the real database with no way back. Snapshotting means
 * dev migrates the copy instead.
 *
 * The database is copied with `VACUUM INTO` over a read-only connection, which
 * yields a transactionally consistent file without asking the user to quit the
 * installed app first. A plain file copy cannot: recent writes live in the
 * `-wal` sidecar and would tear.
 */

import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

// node:sqlite is still flagged experimental and warns on first import. The
// filter has to be installed before that import runs, and ESM evaluates every
// static import ahead of the module body — hence the dynamic import below.
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.name !== "ExperimentalWarning") console.warn(warning);
});
const { DatabaseSync } = await import("node:sqlite");

const DB_FILE = "state.sqlite";

/**
 * Files and directories worth carrying over, and the reason each one earns its
 * place. Everything absent from this list is deliberately left behind.
 */
const COPIED_FILES = [
  "settings.json",
  "keybindings.json",
  "client-settings.json",
  "desktop-settings.json",
];
const COPIED_DIRS = [
  // Provider credentials, so agents can actually run in the dev build.
  "secrets",
  // Thread attachments, so images in copied threads resolve instead of 404ing.
  "attachments",
];
/**
 * Deliberately skipped:
 * - `logs/`            ~900MB of noise.
 * - `environment-id`   copying it makes the dev build impersonate the installed
 *                      one; letting dev mint its own keeps the identities apart.
 * - `server-runtime.json`  written per-run by whichever server owns the dir.
 * - `cloud-auth-token.json` / `clerk-tokens.json`  cloud credentials; copy by
 *                      hand if the dev build prompts you to sign in.
 */

export function resolveSnapshotPaths({
  source = NodePath.join(NodeOS.homedir(), ".t3"),
  dest = NodePath.join(NodeOS.homedir(), ".t3-devcopy"),
} = {}) {
  return {
    sourceBase: source,
    destBase: dest,
    sourceState: NodePath.join(source, "userdata"),
    destState: NodePath.join(dest, "userdata"),
    sourceDb: NodePath.join(source, "userdata", DB_FILE),
    destDb: NodePath.join(dest, "userdata", DB_FILE),
  };
}

function openReadOnly(path) {
  return new DatabaseSync(path, { readOnly: true });
}

function inspect(path) {
  const db = openReadOnly(path);
  try {
    return {
      integrity: db.prepare("PRAGMA integrity_check").get().integrity_check,
      migration: db.prepare("SELECT MAX(migration_id) AS m FROM effect_sql_migrations").get().m,
      threads: db.prepare("SELECT COUNT(*) AS c FROM projection_threads").get().c,
    };
  } finally {
    db.close();
  }
}

export function snapshotInstalledDatabase(options = {}) {
  const paths = resolveSnapshotPaths(options);
  const log = options.log ?? console.log;

  if (!NodeFS.existsSync(paths.sourceDb)) {
    throw new Error(
      `No installed database at ${paths.sourceDb}. Run the installed app once, or pass --source <dir>.`,
    );
  }

  NodeFS.mkdirSync(paths.destState, { recursive: true });

  // VACUUM INTO refuses to overwrite, so clear any previous snapshot (and the
  // sidecars a prior dev run may have left beside it).
  for (const suffix of ["", "-wal", "-shm"]) {
    NodeFS.rmSync(`${paths.destDb}${suffix}`, { force: true });
  }

  const startedAt = Date.now();
  const db = openReadOnly(paths.sourceDb);
  try {
    db.exec(`VACUUM INTO '${paths.destDb.replaceAll("\\", "/").replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  for (const file of COPIED_FILES) {
    const from = NodePath.join(paths.sourceState, file);
    if (NodeFS.existsSync(from))
      NodeFS.cpSync(from, NodePath.join(paths.destState, file), { force: true });
  }
  for (const dir of COPIED_DIRS) {
    const from = NodePath.join(paths.sourceState, dir);
    if (NodeFS.existsSync(from)) {
      NodeFS.cpSync(from, NodePath.join(paths.destState, dir), { recursive: true, force: true });
    }
  }

  const source = inspect(paths.sourceDb);
  const snapshot = inspect(paths.destDb);
  const megabytes = (NodeFS.statSync(paths.destDb).size / 1024 / 1024).toFixed(0);

  if (snapshot.integrity !== "ok") {
    throw new Error(`Snapshot failed integrity_check: ${snapshot.integrity}`);
  }
  if (snapshot.migration !== source.migration) {
    throw new Error(
      `Snapshot migration head ${snapshot.migration} != source ${source.migration}; copy is not trustworthy.`,
    );
  }

  log(`[snapshot] ${paths.sourceDb}`);
  log(`[snapshot]   -> ${paths.destDb}`);
  log(
    `[snapshot] ${megabytes}MB in ${seconds}s · integrity ok · migration ${snapshot.migration} · ${snapshot.threads} threads`,
  );

  return { ...paths, ...snapshot, megabytes: Number(megabytes) };
}

/** True when no usable snapshot exists yet at `dest`. */
export function snapshotIsMissing(options = {}) {
  return !NodeFS.existsSync(resolveSnapshotPaths(options).destDb);
}

/** Age of the snapshot in hours, or undefined when there isn't one. */
export function snapshotAgeHours(options = {}) {
  const { destDb } = resolveSnapshotPaths(options);
  if (!NodeFS.existsSync(destDb)) return undefined;
  return (Date.now() - NodeFS.statSync(destDb).mtimeMs) / 1000 / 60 / 60;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--source") options.source = argv[index + 1];
    if (argv[index] === "--dest") options.dest = argv[index + 1];
  }
  return options;
}

// pathToFileURL, not string concatenation: a Windows argv path produces
// `file:///C:/...` and a hand-built `file://${path}` would never match it.
if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href) {
  try {
    snapshotInstalledDatabase(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`[snapshot] ${error.message}`);
    process.exitCode = 1;
  }
}
