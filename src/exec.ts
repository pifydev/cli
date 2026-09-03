import { spawn, spawnSync } from "node:child_process";
import { PifyError, ExitCode } from "./errors.js";

export const isWindows = process.platform === "win32";

/**
 * On Windows, npm installs global binaries as `.cmd` shims. Since the fix for
 * CVE-2024-27980, Node refuses to spawn `.cmd`/`.bat` without `shell: true`,
 * so every delegated call has to go through the shell there.
 *
 * A shell means the argument vector is re-parsed by cmd.exe, so nothing
 * attacker-influenced may reach it unquoted. Everything we pass is validated by
 * `assertSafeArg` first; that check is the load-bearing half of this decision.
 */
const SAFE_ARG = /^[A-Za-z0-9@._:/\\+=^-]+$/;

export function assertSafeArg(arg: string, what = "argument"): void {
  if (!SAFE_ARG.test(arg)) {
    throw new PifyError(
      `Refusing to pass unsafe ${what} to a subprocess: ${JSON.stringify(arg)}`,
      ExitCode.USAGE,
      "Package names may contain letters, digits and @ . _ : / \\ + = ^ - only.",
    );
  }
}

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Build the (command, args, options) triple for spawn. On Windows we join the
 * pre-validated args into a single command line ourselves: passing an args
 * array alongside `shell: true` is deprecated (DEP0190), and every argument
 * has already passed `assertSafeArg`, so plain joining cannot inject.
 */
function spawnPlan(command: string, args: string[]) {
  assertSafeArg(command, "command");
  args.forEach((a) => assertSafeArg(a));
  return isWindows
    ? ([`${command} ${args.join(" ")}`.trim(), [] as string[], { shell: true }] as const)
    : ([command, args, { shell: false }] as const);
}

/** Run a command and capture its output. Never throws on non-zero exit. */
export function runCapture(command: string, args: string[]): RunResult {
  const [cmd, argv, opts] = spawnPlan(command, args);
  const res = spawnSync(cmd, argv, {
    ...opts,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: res.status ?? (res.error ? 127 : 1),
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

/**
 * Run a command with its output streamed straight to the user's terminal.
 * Used for installs, where npm's own progress reporting is better than
 * anything we would put in front of it.
 */
export function runInherit(command: string, args: string[]): Promise<number> {
  const [cmd, argv, opts] = spawnPlan(command, args);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, {
      ...opts,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** Absolute path of a command on PATH, or null. */
export function which(command: string): string | null {
  const finder = isWindows ? "where" : "which";
  const [cmd, argv, opts] = spawnPlan(finder, [command]);
  const res = spawnSync(cmd, argv, {
    ...opts,
    encoding: "utf8",
    windowsHide: true,
  });
  if (res.status !== 0) return null;
  const first = (res.stdout ?? "").split(/\r?\n/).find((l) => l.trim().length > 0);
  return first ? first.trim() : null;
}
