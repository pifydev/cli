import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { PifyError, ExitCode } from "./errors.js";

export const isWindows = process.platform === "win32";

/** True when the user asked for offline behavior (pi's env var is honored too). */
export function isOffline(): boolean {
  for (const name of ["PIFY_OFFLINE", "PI_OFFLINE"]) {
    const v = process.env[name];
    if (v && /^(1|true|yes)$/i.test(v)) return true;
  }
  return false;
}

/**
 * SECURITY-CRITICAL. On Windows, npm installs global binaries as `.cmd` shims.
 * Since the fix for CVE-2024-27980, Node refuses to spawn `.cmd`/`.bat`
 * without a shell, so every delegated call goes through cmd.exe there — which
 * re-parses the command line. Therefore every token must pass this allowlist
 * before any process starts. No spaces, quotes, `%`, `&`, `|`, `<`, `>`,
 * `(`, `)`, `!`, `~`, or `^` (cmd's escape character; excluding it also
 * enforces the exact-version-pin rule). Any future feature passing free text
 * through this module must be refused by this regex, not accommodated by
 * loosening it.
 */
const SAFE_ARG = /^[A-Za-z0-9@._:/\\+=-]+$/;

export function assertSafeArg(arg: string, what = "argument"): void {
  if (!SAFE_ARG.test(arg)) {
    throw new PifyError(
      `Refusing to pass unsafe ${what} to a subprocess: ${JSON.stringify(arg)}`,
      ExitCode.USAGE,
      "Package names may contain letters, digits and @ . _ : / \\ + = - only.",
    );
  }
}

/**
 * Build the (command, args, shell) triple for spawn. On Windows we join the
 * validated tokens into a single command line ourselves: an args array
 * alongside `shell: true` is deprecated (DEP0190). Tokens are always bare
 * command names (`npm`, `pi`) so cmd/PATH resolves the shim — never absolute
 * paths, which may contain spaces.
 */
function spawnPlan(command: string, args: string[]) {
  assertSafeArg(command, "command");
  args.forEach((a) => assertSafeArg(a));
  return isWindows
    ? ([`${command} ${args.join(" ")}`.trim(), [] as string[], { shell: true }] as const)
    : ([command, args, { shell: false }] as const);
}

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
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

/**
 * Run one of pi's official installer one-liners, exactly as documented at
 * pi.dev, with inherited stdio (they are interactive TUIs).
 *
 * SECURITY: this bypasses assertSafeArg because the command lines are fixed
 * constants defined in pi.ts — no user input ever reaches this function.
 * Keep it that way: any parameterization must go through spawnPlan instead.
 */
export function runOfficialInstaller(kind: "windows" | "posix"): Promise<number> {
  const [cmd, argv] =
    kind === "windows"
      ? ([
          "powershell",
          ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://pi.dev/install.ps1 | iex"],
        ] as const)
      : (["sh", ["-c", "curl -fsSL https://pi.dev/install.sh | sh"]] as const);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { stdio: "inherit", windowsHide: false });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * Absolute path of a command on PATH, or null. In-process scan (no child
 * process): PATHEXT-aware on Windows, executable-bit check on POSIX.
 */
export function which(command: string): string | null {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  if (isWindows) {
    const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
      .split(";")
      .filter(Boolean);
    for (const dir of dirs) {
      // A name that already carries an extension is checked as-is first.
      const candidates = command.includes(".")
        ? [join(dir, command)]
        : exts.map((ext) => join(dir, command + ext));
      for (const candidate of candidates) {
        try {
          if (statSync(candidate).isFile()) return candidate;
        } catch {
          // keep scanning
        }
      }
    }
    return null;
  }
  for (const dir of dirs) {
    const candidate = join(dir, command);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep scanning
    }
  }
  return null;
}
