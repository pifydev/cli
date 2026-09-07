import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadCatalog, resolveInstallTarget } from "../catalog.js";
import { ExitCode, PifyError, notFoundError, usageError } from "../errors.js";
import { delegate, installedPifyPackages, installedVersionOnDisk, requirePi } from "../pi.js";
import { hint, out, step, style, success, warn } from "../ui.js";

/**
 * A profile is the suite you actually run, written down: which packages, at
 * which versions, in which scope. Reproducing that on a second machine is
 * otherwise a memory exercise.
 *
 * Applying always shows the difference first and asks for `--yes`. The idea
 * (and the discipline that applying passes through a review) is from
 * ayagmar/pi-extmgr's profiles; what it drops is the interactive screen,
 * because a CLI's review is a diff and an explicit flag.
 */

export const PROFILE_VERSION = 1;

export interface ProfileEntry {
  name: string;
  /** Exact version recorded at save time, or null when it was unknown. */
  version: string | null;
  scope: "user" | "project";
}

export interface Profile {
  version: number;
  createdAt: string;
  packages: ProfileEntry[];
}

export function buildProfile(now: Date = new Date()): Profile {
  const installed = installedPifyPackages();
  const packages: ProfileEntry[] = [...installed.values()]
    .map((entry) => ({
      name: entry.name,
      version: installedVersionOnDisk(entry.name, entry.scope).version,
      scope: entry.scope,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { version: PROFILE_VERSION, createdAt: now.toISOString(), packages };
}

/** Read a profile file, refusing anything this version cannot honour. */
export function parseProfile(raw: string): Profile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw usageError("That profile is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null) throw usageError("That profile is not an object.");
  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== PROFILE_VERSION) {
    throw usageError(
      `Unsupported profile version ${String(candidate.version)}.`,
      `This pify writes and reads version ${PROFILE_VERSION}.`,
    );
  }
  if (!Array.isArray(candidate.packages)) throw usageError("That profile has no packages array.");

  const packages: ProfileEntry[] = [];
  for (const entry of candidate.packages) {
    if (typeof entry !== "object" || entry === null) throw usageError("A profile entry is not an object.");
    const e = entry as Record<string, unknown>;
    if (typeof e.name !== "string" || !/^[a-z0-9._-]+$/.test(e.name)) {
      throw usageError(`Invalid package name in profile: ${JSON.stringify(e.name)}`);
    }
    if (e.version !== null && typeof e.version !== "string") {
      throw usageError(`Invalid version for ${e.name} in profile.`);
    }
    if (e.scope !== "user" && e.scope !== "project") {
      throw usageError(`Invalid scope for ${e.name} in profile.`);
    }
    packages.push({ name: e.name, version: e.version, scope: e.scope });
  }
  return { version: PROFILE_VERSION, createdAt: String(candidate.createdAt ?? ""), packages };
}

export type PlanAction = "install" | "change" | "keep" | "extra";

export interface PlanRow {
  name: string;
  action: PlanAction;
  from: string | null;
  to: string | null;
}

/**
 * What applying this profile would do. Packages installed here but absent from
 * the profile are reported as `extra` and never removed: a profile says what
 * must be present, and deleting whatever else someone installed is not a
 * decision this command gets to make silently.
 */
export function planApply(profile: Profile, installedNow: Map<string, { scope: "user" | "project" }>): PlanRow[] {
  const rows: PlanRow[] = [];
  for (const entry of profile.packages) {
    const current = installedNow.get(entry.name);
    if (!current) {
      rows.push({ name: entry.name, action: "install", from: null, to: entry.version });
      continue;
    }
    const onDisk = installedVersionOnDisk(entry.name, current.scope).version;
    if (entry.version && onDisk && entry.version !== onDisk) {
      rows.push({ name: entry.name, action: "change", from: onDisk, to: entry.version });
    } else {
      rows.push({ name: entry.name, action: "keep", from: onDisk, to: entry.version });
    }
  }
  for (const [name] of installedNow) {
    if (!profile.packages.some((p) => p.name === name)) {
      rows.push({ name, action: "extra", from: installedVersionOnDisk(name, "user").version, to: null });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export interface ProfileOptions {
  yes: boolean;
  json: boolean;
}

function describe(row: PlanRow): string {
  switch (row.action) {
    case "install":
      return `install ${row.to ? `@ ${row.to}` : "(latest)"}`;
    case "change":
      return `${row.from} → ${row.to}`;
    case "keep":
      return `already ${row.from ?? "installed"}`;
    case "extra":
      return `installed here, not in the profile (left alone)`;
  }
}

export async function profile(args: string[], opts: ProfileOptions): Promise<number> {
  const [sub, file] = args;
  if (sub === "save") {
    const target = resolve(file ?? "pify-profile.json");
    const built = buildProfile();
    if (built.packages.length === 0) {
      warn("No @pify packages are installed; saving an empty profile.");
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(built, null, 2)}\n`);
    success(`Saved ${built.packages.length} package(s) to ${target}`);
    return 0;
  }

  if (sub === "apply") {
    if (!file) throw usageError("Which profile?", "Usage: pify profile apply <file> [--yes]");
    const target = resolve(file);
    if (!existsSync(target)) throw notFoundError(`No profile at ${target}.`);
    const parsed = parseProfile(readFileSync(target, "utf8"));

    // Every name goes through the same resolution as a typed install, so a
    // profile can never reach outside the @pify scope.
    const catalog = await loadCatalog();
    for (const entry of parsed.packages) resolveInstallTarget(catalog, entry.name);

    const rows = planApply(parsed, installedPifyPackages());
    if (opts.json) {
      out(JSON.stringify({ profile: target, plan: rows }, null, 2));
      return 0;
    }

    const width = rows.reduce((m, r) => Math.max(m, r.name.length), 0);
    out(style.bold(`Applying ${target}`));
    out();
    for (const row of rows) {
      out(`  ${row.action.padEnd(8)}${row.name.padEnd(width + 2)}${style.dim(describe(row))}`);
    }
    out();

    const work = rows.filter((r) => r.action === "install" || r.action === "change");
    if (work.length === 0) {
      success("Nothing to do — this machine already matches the profile.");
      return 0;
    }
    if (!opts.yes) {
      hint(`${work.length} package(s) would change. Re-run with --yes to apply.`);
      return 0;
    }

    requirePi();
    const failed: string[] = [];
    for (const row of work) {
      const spec = row.to ? `npm:@pify/${row.name}@${row.to}` : `npm:@pify/${row.name}`;
      const argv = ["install", spec];
      step(`pi ${argv.join(" ")}`);
      if ((await delegate(argv)) !== 0) failed.push(row.name);
    }
    if (failed.length > 0) {
      throw new PifyError(`Failed for: ${failed.join(", ")}`, ExitCode.SUBPROCESS);
    }
    success(`Applied ${work.length} package(s).`);
    return 0;
  }

  throw usageError(
    `Unknown profile subcommand ${JSON.stringify(sub ?? "")}.`,
    "Usage: pify profile save [file] | pify profile apply <file> [--yes]",
  );
}
