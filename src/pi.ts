import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runCapture, runInherit, which } from "./exec.js";
import { environmentError, PifyError, ExitCode } from "./errors.js";
import { step, success } from "./ui.js";

/** The npm package that provides the `pi` binary. */
export const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/** Minimum Node version required by the pi coding agent. */
export const NODE_FLOOR = "22.19.0";

export interface PiStatus {
  installed: boolean;
  /** Absolute path to the `pi` launcher, when installed. */
  binPath: string | null;
  /** Version reported by `pi --version`, when installed. */
  version: string | null;
}

export function piStatus(): PiStatus {
  const binPath = which("pi");
  if (!binPath) return { installed: false, binPath: null, version: null };
  const res = runCapture("pi", ["--version"]);
  const version = res.status === 0 ? res.stdout.trim() || null : null;
  return { installed: true, binPath, version };
}

/** Latest published version of a package, via `npm view`. Null when offline. */
export function latestVersion(pkg: string): string | null {
  if (process.env.PIFY_OFFLINE === "1" || process.env.PI_OFFLINE === "1") return null;
  const res = runCapture("npm", ["view", pkg, "version"]);
  if (res.status !== 0) return null;
  const v = res.stdout.trim();
  return /^\d+\.\d+\.\d+/.test(v) ? v : null;
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10));
  const pb = b.split(".").map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function assertNodeVersion(): void {
  const current = process.versions.node;
  if (compareSemver(current, NODE_FLOOR) < 0) {
    throw environmentError(
      `The pi coding agent requires Node >= ${NODE_FLOOR}; you are running ${current}.`,
      "Upgrade Node (e.g. via nvm / nvm-windows) and try again.",
    );
  }
}

/**
 * Install pi globally via npm. This is the one operation pi cannot do for
 * itself — `pi update --self` requires a working pi.
 */
export async function installPi(): Promise<void> {
  assertNodeVersion();
  if (!which("npm")) {
    throw environmentError(
      "npm was not found on PATH.",
      "Install Node.js (which bundles npm) from https://nodejs.org and retry.",
    );
  }
  step(`Installing ${PI_PACKAGE} globally via npm...`);
  // --ignore-scripts matches pi's own self-update invocation.
  const code = await runInherit("npm", ["install", "-g", "--ignore-scripts", PI_PACKAGE]);
  if (code !== 0) {
    throw new PifyError(
      `npm install -g ${PI_PACKAGE} exited with code ${code}.`,
      ExitCode.SUBPROCESS,
      process.platform === "win32"
        ? "If this is a permissions error, retry from an elevated terminal."
        : "If this is a permissions error, fix npm's global prefix (https://docs.npmjs.com/resolving-eacces-permissions-errors) rather than using sudo.",
    );
  }
  const st = piStatus();
  success(`pi ${st.version ?? ""} installed.`.trimEnd());
}

/**
 * Update pi. Delegates to `pi update --self`, which stages and verifies the
 * release before activating it — strictly safer than a blind npm reinstall.
 */
export async function updatePi(): Promise<void> {
  const st = piStatus();
  if (!st.installed) {
    await installPi();
    return;
  }
  step(`Updating pi (current: ${st.version ?? "unknown"})...`);
  const code = await runInherit("pi", ["update", "--self"]);
  if (code !== 0) {
    throw new PifyError(`pi update --self exited with code ${code}.`, ExitCode.SUBPROCESS);
  }
}

/** Ensure pi exists before a delegated command; offer context when it doesn't. */
export function requirePi(): void {
  if (!piStatus().installed) {
    throw environmentError(
      "The pi coding agent is not installed.",
      "Run `pify setup` to install it.",
    );
  }
}

/** Delegate a pi subcommand, streaming output. Returns the exit code. */
export function delegate(args: string[]): Promise<number> {
  requirePi();
  return runInherit("pi", args);
}

export interface PiSettings {
  packages?: Array<string | { source: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

export function settingsPath(scope: "user" | "project"): string {
  return scope === "user"
    ? join(homedir(), ".pi", "agent", "settings.json")
    : join(process.cwd(), ".pi", "settings.json");
}

/**
 * Read-only view of pi settings. All writes go through the pi CLI — pi owns
 * that state (dedup rules, npm workspace, trust model), and two writers would
 * eventually disagree.
 */
export function readSettings(scope: "user" | "project"): PiSettings | null {
  try {
    return JSON.parse(readFileSync(settingsPath(scope), "utf8")) as PiSettings;
  } catch {
    return null;
  }
}

/** Sources of installed packages across both scopes, e.g. "npm:@pify/goal". */
export function installedSources(): Map<string, "user" | "project"> {
  const result = new Map<string, "user" | "project">();
  for (const scope of ["user", "project"] as const) {
    const settings = readSettings(scope);
    for (const entry of settings?.packages ?? []) {
      const source = typeof entry === "string" ? entry : entry.source;
      if (source) result.set(source, scope);
    }
  }
  return result;
}
