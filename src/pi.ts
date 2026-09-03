import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isOffline, isWindows, runCapture, runInherit, which } from "./exec.js";
import { environmentError, PifyError, ExitCode } from "./errors.js";
import { step, success } from "./ui.js";
import { VERSION } from "./version.js";

/** The npm package that provides the `pi` binary. */
export const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/** Minimum Node version required by the pi coding agent. */
export const NODE_FLOOR = "22.19.0";

/** The pi version this CLI release was developed and tested against. */
export const TESTED_PI_VERSION = "0.84.4";

const LATEST_VERSION_URL = "https://pi.dev/api/latest-version";

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

/** Latest pi version from pi's own release endpoint. Null offline/on error. */
export async function fetchLatestPiVersion(): Promise<string | null> {
  if (isOffline()) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(LATEST_VERSION_URL, {
      signal: controller.signal,
      headers: { "user-agent": `pify/${VERSION}` },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
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
 * Whether a binary lives under npm's global prefix. Both sides are
 * realpath'd: version managers (nvm4w, nvm) expose the prefix through a
 * symlink, so comparing a resolved bin against an unresolved prefix would
 * wrongly report "not managed". Returns the prefix for diagnostics.
 */
export function npmPrefixEvidence(binPath: string): { managed: boolean; prefix: string | null } {
  const res = runCapture("npm", ["prefix", "-g"]);
  const prefix = res.status === 0 ? res.stdout.trim() : "";
  if (!prefix) return { managed: false, prefix: null };
  const resolve = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const normalize = (p: string) => (isWindows ? p.toLowerCase() : p);
  const managed = normalize(resolve(binPath)).startsWith(normalize(resolve(prefix)));
  return { managed, prefix };
}

/**
 * Refuse to `npm install -g` over an existing pi that npm does not manage.
 * Evidence-based, never path-shape guessing: `npm prefix -g` is the only
 * authority (Windows global prefixes are indistinguishable by shape,
 * especially under nvm4w).
 */
export function guardNpmManaged(binPath: string): void {
  if (process.env.PI_MANAGED_INSTALL_ROOT) {
    throw environmentError("pi is a managed install; pify will not overwrite it.");
  }
  if (!npmPrefixEvidence(binPath).managed) {
    throw environmentError(
      `pi at ${binPath} is not managed by npm; refusing to install over it.`,
      "Update it with the package manager that installed it (pnpm/yarn/bun), or remove it first.",
    );
  }
}

/**
 * Install pi globally via npm. This is the one operation pi cannot do for
 * itself — `pi update --self` requires a working pi. `--ignore-scripts`
 * matches pi's own self-update invocation (supply-chain-safe default).
 */
export async function installPi(version?: string): Promise<void> {
  assertNodeVersion();
  if (!which("npm")) {
    throw environmentError(
      "npm was not found on PATH.",
      "Install Node.js (which bundles npm) from https://nodejs.org and retry.",
    );
  }
  if (process.env.PI_MANAGED_INSTALL_ROOT && !piStatus().installed) {
    throw environmentError(
      "PI_MANAGED_INSTALL_ROOT is set but pi is not installed.",
      "Use the managed installer: curl -fsSL https://pi.dev/install.sh | sh (Linux/macOS).",
    );
  }
  const spec = version ? `${PI_PACKAGE}@${version}` : PI_PACKAGE;
  step(`npm install -g --ignore-scripts ${spec}`);
  const code = await runInherit("npm", ["install", "-g", "--ignore-scripts", spec]);
  if (code !== 0) {
    throw new PifyError(
      `npm install -g ${spec} exited with code ${code}.`,
      ExitCode.SUBPROCESS,
      isWindows
        ? "If this is a permissions or file-lock error, close running pi sessions and retry from an elevated terminal."
        : "If this is an EACCES error, configure a user-writable npm prefix (https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally) or use a Node version manager.",
    );
  }
  const st = piStatus();
  if (!st.installed) {
    throw environmentError(
      "pi was installed but is not resolvable on PATH.",
      "Add npm's global prefix to PATH (npm prefix -g) and open a new terminal.",
    );
  }
  success(`pi ${st.version ?? ""} installed.`.replace("  ", " "));
}

/**
 * Update pi. Delegates to bare `pi update` (its default target is self):
 * pi's updater owns install-method detection, the pi.dev rename protocol,
 * managed-install staging, and the Windows native-module quarantine.
 * Reimplementing any of it would rot. When pi is absent, fall through to a
 * fresh install so `npx @pify/cli update` works on a bare machine.
 */
export async function updatePi(): Promise<void> {
  const st = piStatus();
  if (!st.installed) {
    await installPi();
    return;
  }
  step("pi update");
  const code = await runInherit("pi", ["update"]);
  if (code !== 0) {
    throw new PifyError(`pi update exited with code ${code}.`, ExitCode.SUBPROCESS);
  }
}

/** Ensure pi exists before a delegated command. */
export function requirePi(): void {
  if (!piStatus().installed) {
    throw environmentError(
      "The pi coding agent is not installed.",
      "Run pify setup to install it.",
    );
  }
}

/** Delegate a pi subcommand, streaming output. Returns the exit code. */
export function delegate(args: string[]): Promise<number> {
  return runInherit("pi", args);
}

export interface PiSettings {
  packages?: Array<string | { source: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

/** pi's agent directory: tilde-expanded PI_CODING_AGENT_DIR or ~/.pi/agent. */
export function agentDir(): string {
  const override = process.env.PI_CODING_AGENT_DIR;
  if (override) {
    return override.startsWith("~")
      ? join(homedir(), override.slice(1).replace(/^[/\\]/, ""))
      : override;
  }
  return join(homedir(), ".pi", "agent");
}

export function settingsPath(scope: "user" | "project"): string {
  return scope === "user"
    ? join(agentDir(), "settings.json")
    : join(process.cwd(), ".pi", "settings.json");
}

/**
 * Read-only view of pi settings. All writes go through the pi CLI — pi owns
 * that state (dedup rules, npm workspace, trust model), and two writers would
 * eventually disagree. Parse failures are treated as absent (doctor warns).
 */
export function readSettings(scope: "user" | "project"): PiSettings | null {
  try {
    return JSON.parse(readFileSync(settingsPath(scope), "utf8")) as PiSettings;
  } catch {
    return null;
  }
}

const PIFY_SOURCE = /^npm:@pify\/([A-Za-z0-9._-]+?)(?:@(.+))?$/;

export interface InstalledPifyPackage {
  name: string;
  scope: "user" | "project";
  source: string;
  pin: string | null;
}

/**
 * @pify packages configured in pi's settings, both scopes, deduped by name
 * (project wins, matching pi's own scope precedence).
 */
export function installedPifyPackages(): Map<string, InstalledPifyPackage> {
  const result = new Map<string, InstalledPifyPackage>();
  for (const scope of ["user", "project"] as const) {
    const settings = readSettings(scope);
    for (const entry of settings?.packages ?? []) {
      const source = typeof entry === "string" ? entry : entry.source;
      if (typeof source !== "string") continue;
      const match = PIFY_SOURCE.exec(source);
      const name = match?.[1];
      if (!name) continue;
      result.set(name, { name, scope, source, pin: match?.[2] ?? null });
    }
  }
  return result;
}

export interface OnDiskState {
  present: boolean;
  version: string | null;
}

/** Version of an installed @pify package as materialized in pi's npm root. */
export function installedVersionOnDisk(name: string, scope: "user" | "project"): OnDiskState {
  const root = scope === "user" ? join(agentDir(), "npm") : join(process.cwd(), ".pi", "npm");
  try {
    const pkg = JSON.parse(
      readFileSync(join(root, "node_modules", "@pify", name, "package.json"), "utf8"),
    ) as { version?: string };
    return { present: true, version: typeof pkg.version === "string" ? pkg.version : null };
  } catch {
    return { present: false, version: null };
  }
}
