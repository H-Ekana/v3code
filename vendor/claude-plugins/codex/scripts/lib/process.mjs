import { spawnSync } from "node:child_process";
import process from "node:process";

export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer,
    stdio: options.stdio ?? "pipe",
    shell: options.shell ?? (process.platform === "win32" ? process.env.SHELL || true : false),
    windowsHide: true,
  });

  return {
    command,
    args,
    status: result.status ?? 0,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

export function runCommandChecked(command, args = [], options = {}) {
  const result = runCommand(command, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }
  return result;
}

export function binaryAvailable(command, versionArgs = ["--version"], options = {}) {
  const result = runCommand(command, versionArgs, options);
  if (result.error && /** @type {NodeJS.ErrnoException} */ (result.error).code === "ENOENT") {
    return { available: false, detail: "not found" };
  }
  if (result.error) {
    return { available: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    return { available: false, detail };
  }
  return { available: true, detail: result.stdout.trim() || result.stderr.trim() || "ok" };
}

function looksLikeMissingProcessMessage(text) {
  return /not found|no running instance|cannot find|does not exist|no such process/i.test(text);
}

function probeProcessWithSignal(pid, killImpl) {
  try {
    killImpl(pid, 0);
    return { exists: true, error: null };
  } catch (error) {
    if (error?.code === "ESRCH") {
      return { exists: false, error: null };
    }
    if (error?.code === "EPERM") {
      return { exists: true, error };
    }
    return { exists: null, error };
  }
}

export function inspectProcessIdentity(pid, options = {}) {
  if (!Number.isFinite(pid)) {
    return {
      pid,
      exists: false,
      creationDate: null,
      commandLine: null,
      executablePath: null,
      error: null,
    };
  }

  const platform = options.platform ?? process.platform;
  const runCommandImpl = options.runCommandImpl ?? runCommand;
  const killImpl = options.killImpl ?? process.kill.bind(process);

  if (platform !== "win32") {
    const probe = probeProcessWithSignal(pid, killImpl);
    return { pid, ...probe, creationDate: null, commandLine: null, executablePath: null };
  }

  const command = [
    "$ErrorActionPreference = 'Stop'",
    `try { $process = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 3 }`,
    "if ($null -eq $process) { exit 4 }",
    "$process | Select-Object ProcessId,CreationDate,CommandLine,ExecutablePath | ConvertTo-Json -Compress",
  ].join("; ");
  const result = runCommandImpl(
    options.powershellCommand ?? "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      cwd: options.cwd,
      env: options.env,
      shell: false,
    },
  );

  if (!result.error && result.status === 4) {
    return {
      pid,
      exists: false,
      creationDate: null,
      commandLine: null,
      executablePath: null,
      error: null,
    };
  }

  if (!result.error && result.status === 0 && result.stdout.trim()) {
    try {
      const parsed = JSON.parse(result.stdout);
      return {
        pid,
        exists: true,
        creationDate: parsed.CreationDate == null ? null : String(parsed.CreationDate),
        commandLine: parsed.CommandLine == null ? null : String(parsed.CommandLine),
        executablePath: parsed.ExecutablePath == null ? null : String(parsed.ExecutablePath),
        error: null,
      };
    } catch {
      // Fall through to the signal probe when PowerShell returned an unexpected shape.
    }
  }

  const probe = probeProcessWithSignal(pid, killImpl);
  const detail =
    result.error?.message ??
    (result.stderr.trim() || result.stdout.trim() || `PowerShell exit ${result.status}`);
  return {
    pid,
    ...probe,
    creationDate: null,
    commandLine: null,
    executablePath: null,
    error: detail ? new Error(detail) : probe.error,
  };
}

function normalizeCommandLine(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function verifyProcessIdentity(pid, expected, options = {}) {
  const inspectProcessImpl = options.inspectProcessImpl ?? inspectProcessIdentity;
  const actual = inspectProcessImpl(pid, options);
  if (actual.exists === false) {
    return { matches: false, actual, detail: `Process ${pid} is no longer running.` };
  }
  if (actual.exists !== true) {
    return {
      matches: false,
      actual,
      detail: `Could not determine whether process ${pid} is running.`,
    };
  }

  let verified = false;
  if (expected?.creationDate) {
    if (!actual.creationDate) {
      return {
        matches: false,
        actual,
        detail: `Could not verify the creation time for process ${pid}.`,
      };
    }
    if (String(actual.creationDate) !== String(expected.creationDate)) {
      return {
        matches: false,
        actual,
        detail: `Process ${pid} has a different creation time than the recorded worker.`,
      };
    }
    verified = true;
  }

  if (expected?.commandLine) {
    if (!actual.commandLine) {
      return {
        matches: false,
        actual,
        detail: `Could not verify the command line for process ${pid}.`,
      };
    }
    if (normalizeCommandLine(actual.commandLine) !== normalizeCommandLine(expected.commandLine)) {
      return {
        matches: false,
        actual,
        detail: `Process ${pid} has a different command line than the recorded worker.`,
      };
    }
    verified = true;
  }

  const commandIncludes = Array.isArray(expected?.commandIncludes)
    ? expected.commandIncludes.filter(Boolean)
    : [];
  if (commandIncludes.length > 0) {
    const actualCommandLine = normalizeCommandLine(actual.commandLine);
    if (!actualCommandLine) {
      return {
        matches: false,
        actual,
        detail: `Could not verify the command line for process ${pid}.`,
      };
    }
    if (
      !commandIncludes.every((value) => actualCommandLine.includes(normalizeCommandLine(value)))
    ) {
      return {
        matches: false,
        actual,
        detail: `Process ${pid} does not match the recorded worker command.`,
      };
    }
    verified = true;
  }

  if (!verified) {
    return {
      matches: false,
      actual,
      detail: `No process identity metadata is available for process ${pid}.`,
    };
  }
  return { matches: true, actual, detail: `Process ${pid} matches the recorded worker.` };
}

export function captureProcessIdentity(pid, options = {}) {
  const actual = inspectProcessIdentity(pid, options);
  const commandIncludes = Array.isArray(options.commandIncludes)
    ? options.commandIncludes.filter(Boolean)
    : [];
  if (actual.exists === true && (actual.creationDate || actual.commandLine)) {
    return {
      pid,
      creationDate: actual.creationDate,
      commandLine: actual.commandLine,
      executablePath: actual.executablePath,
      ...(commandIncludes.length > 0 ? { commandIncludes } : {}),
    };
  }
  return commandIncludes.length > 0 ? { pid, commandIncludes } : null;
}

export function terminateProcessTree(pid, options = {}) {
  if (!Number.isFinite(pid)) {
    return { attempted: false, delivered: false, method: null };
  }

  const platform = options.platform ?? process.platform;
  const runCommandImpl = options.runCommandImpl ?? runCommand;
  const killImpl = options.killImpl ?? process.kill.bind(process);

  if (options.expectedProcess) {
    const verification = verifyProcessIdentity(pid, options.expectedProcess, {
      ...options,
      platform,
      runCommandImpl,
      killImpl,
    });
    if (!verification.matches) {
      return {
        attempted: false,
        delivered: false,
        method: null,
        refused: true,
        detail: verification.detail,
        verification,
      };
    }
  }

  if (platform === "win32") {
    const result = runCommandImpl("taskkill", ["/PID", String(pid), "/T", "/F"], {
      cwd: options.cwd,
      env: options.env,
    });

    if (!result.error && result.status === 0) {
      return { attempted: true, delivered: true, method: "taskkill", result };
    }

    const combinedOutput = `${result.stderr}\n${result.stdout}`.trim();
    if (!result.error && looksLikeMissingProcessMessage(combinedOutput)) {
      return { attempted: true, delivered: false, method: "taskkill", result };
    }

    if (result.error?.code === "ENOENT") {
      try {
        killImpl(pid);
        return { attempted: true, delivered: true, method: "kill" };
      } catch (error) {
        if (error?.code === "ESRCH") {
          return { attempted: true, delivered: false, method: "kill" };
        }
        throw error;
      }
    }

    if (result.error) {
      throw result.error;
    }

    throw new Error(formatCommandFailure(result));
  }

  try {
    killImpl(-pid, "SIGTERM");
    return { attempted: true, delivered: true, method: "process-group" };
  } catch (error) {
    if (error?.code !== "ESRCH") {
      try {
        killImpl(pid, "SIGTERM");
        return { attempted: true, delivered: true, method: "process" };
      } catch (innerError) {
        if (innerError?.code === "ESRCH") {
          return { attempted: true, delivered: false, method: "process" };
        }
        throw innerError;
      }
    }

    return { attempted: true, delivered: false, method: "process-group" };
  }
}

export function formatCommandFailure(result) {
  const parts = [`${result.command} ${result.args.join(" ")}`.trim()];
  if (result.signal) {
    parts.push(`signal=${result.signal}`);
  } else {
    parts.push(`exit=${result.status}`);
  }
  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  if (stderr) {
    parts.push(stderr);
  } else if (stdout) {
    parts.push(stdout);
  }
  return parts.join(": ");
}
