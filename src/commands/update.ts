import { loadCatalog, refreshCatalog, resolvePifyName } from "../catalog.js";
import {
  compareSemver,
  delegate,
  fetchLatestPackageVersion,
  fetchLatestPiVersion,
  installedPifyPackages,
  installedVersionOnDisk,
  installPi,
  piStatus,
} from "../pi.js";
import type { InstalledPifyPackage, OnDiskState } from "../pi.js";
import { isOffline } from "../exec.js";
import { usageError, notFoundError, PifyError, ExitCode } from "../errors.js";
import { out, step, success, hint, warn } from "../ui.js";

export interface UpdateOptions {
  catalogOnly: boolean;
  dryRun: boolean;
  /** Report what is out of date and change nothing (v0.4). */
  check: boolean;
  json: boolean;
}

export interface UpdateStatus {
  name: string;
  installed: string | null;
  latest: string | null;
  /** The exact pin holding this package back, if any (packages only). */
  pin: string | null;
  /**
   * "pinned" means behind the registry but held at an exact version, so
   * `pify update` will not (and should not) advance it — the user must re-pin.
   */
  state: "current" | "outdated" | "missing" | "unknown" | "pinned";
}

/** pi plus every installed @pify package, in one snapshot. */
export interface UpdateReport {
  pi: UpdateStatus;
  packages: UpdateStatus[];
}

/**
 * Seams for the check, so a test can drive checkUpdates without a real pi
 * install or a network round-trip. Every field defaults to the live primitive.
 */
export interface CheckUpdatesDeps {
  installed?: Map<string, InstalledPifyPackage>;
  versionOnDisk?: (name: string, scope: "user" | "project") => OnDiskState;
  latestPackage?: (name: string) => Promise<string | null>;
  /** pi's own installed version; `undefined` means ask piStatus(). */
  piVersion?: string | null;
  latestPi?: () => Promise<string | null>;
}

/** The pi row: not installed -> missing, either version unknown -> unknown. */
function piRow(installed: string | null, latest: string | null): UpdateStatus {
  const base = { name: "pi", installed, latest, pin: null };
  if (installed === null) return { ...base, state: "missing" };
  if (latest === null) return { ...base, state: "unknown" };
  return { ...base, state: compareSemver(installed, latest) < 0 ? "outdated" : "current" };
}

/**
 * Compare what is installed against what is published, without installing
 * anything. Separating the question from the action is the point: "is there
 * anything to do" is asked far more often than "do it", and it should not
 * cost a package install to find out.
 *
 * pi is checked alongside the packages because `pify update` updates pi first;
 * a check that skipped it would say "current" and then `pify update` would
 * upgrade the agent the user was told nothing about. Its latest-version fetch
 * rides in the SAME Promise.all as the packages', so adding it costs no serial
 * latency.
 */
export async function checkUpdates(deps: CheckUpdatesDeps = {}): Promise<UpdateReport> {
  const installed = deps.installed ?? installedPifyPackages();
  const versionOnDisk = deps.versionOnDisk ?? installedVersionOnDisk;
  const latestPackage = deps.latestPackage ?? fetchLatestPackageVersion;
  const piVersion = deps.piVersion !== undefined ? deps.piVersion : piStatus().version;
  const latestPi = deps.latestPi ?? fetchLatestPiVersion;

  const names = [...installed.keys()].sort();
  const [piLatest, ...packages] = await Promise.all([
    latestPi(),
    ...names.map(async (name): Promise<UpdateStatus> => {
      const entry = installed.get(name)!;
      const onDisk = versionOnDisk(name, entry.scope);
      const latest = await latestPackage(name);
      const pin = entry.pin;
      if (!onDisk.present) return { name, installed: null, latest, pin, state: "missing" };
      if (!onDisk.version || !latest) {
        return { name, installed: onDisk.version, latest, pin, state: "unknown" };
      }
      // Behind the registry: a pinned package cannot be advanced by `pify
      // update`, so it is "pinned" (re-pin), not "outdated" (updatable).
      const behind = compareSemver(onDisk.version, latest) < 0;
      const state = behind ? (pin !== null ? "pinned" : "outdated") : "current";
      return { name, installed: onDisk.version, latest, pin, state };
    }),
  ]);

  return { pi: piRow(piVersion, piLatest), packages };
}

/** The right-hand column of the --check table for one row. */
function checkDetail(status: UpdateStatus): string {
  switch (status.state) {
    case "outdated":
      return `${status.installed} → ${status.latest}`;
    case "pinned":
      return `${status.installed} pinned, ${status.latest} available - pify install ${status.name}@${status.latest}`;
    case "missing":
      return status.name === "pi" ? "not installed" : "configured but not on disk";
    case "unknown":
      return `${status.installed ?? "?"} (registry unreachable)`;
    default:
      return `${status.installed}`;
  }
}

/**
 * Update the whole suite in one pass. This earns its existence because
 * upstream splits the work across `pi update` (self only) and
 * `pi update --extensions` (which would also touch non-Pify packages the
 * user manages separately).
 */
export async function update(targets: string[], opts: UpdateOptions): Promise<number> {
  if (isOffline()) {
    warn("PIFY_OFFLINE/PI_OFFLINE is set - updates skipped.");
    return 0;
  }

  if (opts.catalogOnly) {
    if (targets.length > 0) {
      throw usageError("--catalog cannot be combined with update targets.");
    }
    const { ok, catalog } = await refreshCatalog();
    if (ok) {
      out(`Catalog refreshed (version ${catalog.version}, ${catalog.packages.length} packages).`);
    } else {
      warn("Could not refresh the catalog; using the existing copy.");
    }
    return 0;
  }

  if (opts.check) {
    if (targets.length > 0) throw usageError("--check reports on everything; drop the package names.");
    const report = await checkUpdates();
    if (opts.json) {
      // Backward-compatible: `packages` keeps its shape; `pi` is a new sibling
      // key so an existing consumer that reads only `packages` is unaffected.
      out(JSON.stringify({ pi: report.pi, packages: report.packages }, null, 2));
      return 0;
    }
    // pi is reported first (it updates first), then the packages.
    const rows = [report.pi, ...report.packages];
    const width = rows.reduce((m, s) => Math.max(m, s.name.length), 0);
    for (const status of rows) {
      out(`  ${status.state.padEnd(9)}${status.name.padEnd(width + 2)}${checkDetail(status)}`);
    }
    if (report.packages.length === 0) hint("No @pify packages installed.");

    const outdatedPackages = report.packages.filter((s) => s.state === "outdated").length;
    const pinnedCount = report.packages.filter((s) => s.state === "pinned").length;
    const piOutdated = report.pi.state === "outdated";
    out();
    if (outdatedPackages > 0) {
      // `pify update` also refreshes pi, so it covers piOutdated too.
      out(`${outdatedPackages} package(s) can be updated: pify update`);
    } else if (piOutdated) {
      out("pi can be updated: pify update pi");
    } else if (pinnedCount > 0) {
      out(`Everything current except ${pinnedCount} pinned package(s) — re-pin to advance.`);
    } else {
      out("Everything is current.");
    }
    return 0;
  }

  const updateEverything = targets.length === 0;
  const piOnly = targets.length === 1 && (targets[0] === "pi" || targets[0] === "self");
  const installed = installedPifyPackages();

  let packageNames: string[] = [];
  if (updateEverything) {
    packageNames = [...installed.keys()].sort();
  } else if (!piOnly) {
    packageNames = targets.map(resolvePifyName);
    for (const name of packageNames) {
      if (!installed.has(name)) {
        throw notFoundError(`${name} is not installed.`, `pify install ${name}`);
      }
    }
  }

  if (opts.dryRun) {
    if (updateEverything || piOnly) out("pi update");
    for (const name of packageNames) out(`pi update npm:@pify/${name}`);
    if (updateEverything) out("refresh catalog");
    return 0;
  }

  const failed: string[] = [];

  // pi self step. Absent pi becomes a fresh install so `npx @pify/cli update`
  // works on a bare machine (a fatal error there stops the whole command).
  // Present pi delegates to its own updater — never npm -g over an existing
  // install; pi owns install-method detection and the rename protocol.
  if (updateEverything || piOnly) {
    if (!piStatus().installed) {
      await installPi();
    } else {
      step("pi update");
      const code = await delegate(["update"]);
      if (code !== 0) failed.push("pi");
    }
  }

  if (packageNames.length > 0 && !piStatus().installed) {
    throw new PifyError(
      "pi is required to update packages.",
      ExitCode.ENVIRONMENT,
      "Run pify setup first.",
    );
  }

  for (const name of packageNames) {
    const args = ["update", `npm:@pify/${name}`];
    step(`pi ${args.join(" ")}`);
    const code = await delegate(args);
    if (code !== 0) failed.push(name);
  }

  if (updateEverything && packageNames.length === 0) {
    hint("No @pify packages installed; nothing more to update.");
  }

  // Opportunistic catalog refresh on full runs; silent on failure.
  if (updateEverything) {
    await loadCatalog({ refresh: true });
  }

  if (failed.length > 0) {
    throw new PifyError(`Update failed for: ${failed.join(", ")}`, ExitCode.SUBPROCESS);
  }
  success("Everything is up to date.");
  return 0;
}
