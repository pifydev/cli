import { accessSync, constants, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isOffline, isWindows, runCapture, runInherit, which } from "./exec.js";
import { environmentError, PifyError, ExitCode } from "./errors.js";
import { hint, step, success } from "./ui.js";
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

/** The official installer one-liner for this OS, for hints and --installer. */
export function officialInstallerCommand(): string {
  return isWindows
    ? 'powershell -c "irm https://pi.dev/install.ps1 | iex"'
    : "curl -fsSL https://pi.dev/install.sh | sh";
}

/** Walk up from a path to its first existing ancestor; writable directory? */
function writableOrCreatable(path: string): boolean {
  let current = path;
  for (;;) {
    try {
      statSync(current);
      break;
    } catch {
      const parent = dirname(current);
      if (parent === current) return false;
      current = parent;
    }
  }
  try {
    if (!statSync(current).isDirectory()) return false;
    accessSync(current, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The npm install argv pi's official installers use:
 * `--ignore-scripts` (supply-chain-safe; matches pi's self-update),
 * `--min-release-age=0` (pi ships npm-shrinkwrap.json, so bypassing npm's
 * release-age gate does not reopen transitive ranges; npm >= 11 only),
 * `--no-fund --no-audit` (noise). Exported for tests.
 */
export function npmInstallPiArgs(spec: string, npmMajor: number, prefix?: string): string[] {
  const args = ["install", "-g", "--ignore-scripts"];
  if (npmMajor >= 11) args.push("--min-release-age=0");
  args.push("--no-fund", "--no-audit");
  if (prefix) args.push("--prefix", prefix);
  args.push(spec);
  return args;
}

function npmMajorVersion(): number {
  const res = runCapture("npm", ["--version"]);
  const major = Number.parseInt(res.stdout.trim().split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? 0 : major;
}

/**
 * Install pi with the same decisions as pi's official installers, minus the
 * interactive parts. This is the one operation pi cannot do for itself —
 * `pi update` requires a working pi.
 *
 * Per-OS behavior (ported from install.sh / install.ps1):
 * - POSIX, npm prefix unwritable, no global pi there: fall back to
 *   `--prefix ~/.local` — never sudo.
 * - POSIX, npm prefix unwritable but an old global pi lives there: stop
 *   (a ~/.local copy would be shadowed by the stale global one).
 * - No npm but bun on PATH: `bun add -g --ignore-scripts` (documented
 *   alternative channel).
 * - Neither: point at the official installer, which can bootstrap Node too.
 */
export async function installPi(version?: string): Promise<void> {
  assertNodeVersion();
  if (process.env.PI_MANAGED_INSTALL_ROOT && !piStatus().installed) {
    throw environmentError(
      "PI_MANAGED_INSTALL_ROOT is set but pi is not installed.",
      `Use the official installer: ${officialInstallerCommand()}`,
    );
  }

  const spec = version ? `${PI_PACKAGE}@${version}` : PI_PACKAGE;
  const npmPath = which("npm");
  const bunPath = which("bun");

  if (!npmPath && !bunPath) {
    throw environmentError(
      "Neither npm nor bun was found on PATH.",
      `Run the official installer (it can install Node too): ${officialInstallerCommand()}`,
    );
  }

  let command: string;
  let args: string[];
  let localPrefix: string | null = null;

  if (npmPath) {
    command = "npm";
    if (!isWindows) {
      const prefixRes = runCapture("npm", ["prefix", "-g"]);
      const prefix = prefixRes.status === 0 ? prefixRes.stdout.trim() : "";
      const prefixWritable =
        prefix !== "" &&
        writableOrCreatable(join(prefix, "lib", "node_modules")) &&
        writableOrCreatable(join(prefix, "bin"));
      if (prefix && !prefixWritable) {
        let staleGlobalPi = false;
        try {
          statSync(join(prefix, "bin", "pi"));
          staleGlobalPi = true;
        } catch {
          // no global pi there
        }
        if (staleGlobalPi) {
          // A ~/.local copy would be shadowed by the stale global install.
          throw environmentError(
            `npm's global directory is not writable (${prefix}) and pi is already installed there.`,
            `Update or remove it first: sudo npm install -g --ignore-scripts ${PI_PACKAGE}`,
          );
        }
        localPrefix = join(homedir(), ".local");
      }
    }
    args = npmInstallPiArgs(spec, npmMajorVersion(), localPrefix ?? undefined);
  } else {
    command = "bun";
    args = ["add", "-g", "--ignore-scripts", spec];
  }

  step(`${command} ${args.join(" ")}`);
  const code = await runInherit(command, args);
  if (code !== 0) {
    throw new PifyError(
      `${command} ${args[0]} exited with code ${code}.`,
      ExitCode.SUBPROCESS,
      isWindows
        ? "If this is a permissions or file-lock error, close running pi sessions and retry from an elevated terminal."
        : `If the problem persists, try the official installer: ${officialInstallerCommand()}`,
    );
  }

  const st = piStatus();
  if (!st.installed) {
    const pathHint = localPrefix
      ? `Add ${join(localPrefix, "bin")} to PATH and open a new terminal.`
      : "Add the global bin directory to PATH (npm prefix -g) and open a new terminal.";
    throw environmentError("pi was installed but is not resolvable on PATH.", pathHint);
  }
  success(`pi ${st.version ?? ""} installed.`.replace("  ", " "));
  if (localPrefix) {
    hint(`Installed under ${localPrefix} because npm's global prefix is not writable.`);
  }
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
