import { loadCatalog, refreshCatalog, resolvePifyName } from "../catalog.js";
import {
  compareSemver,
  delegate,
  fetchLatestPackageVersion,
  installedPifyPackages,
  installedVersionOnDisk,
  installPi,
  piStatus,
} from "../pi.js";
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
  state: "current" | "outdated" | "missing" | "unknown";
}

/**
 * Compare what is installed against what is published, without installing
 * anything. Separating the question from the action is the point: "is there
 * anything to do" is asked far more often than "do it", and it should not
 * cost a package install to find out.
 */
export async function checkUpdates(): Promise<UpdateStatus[]> {
  const installed = installedPifyPackages();
  const names = [...installed.keys()].sort();
  const statuses = await Promise.all(
    names.map(async (name): Promise<UpdateStatus> => {
      const entry = installed.get(name)!;
      const onDisk = installedVersionOnDisk(name, entry.scope);
      const latest = await fetchLatestPackageVersion(name);
      if (!onDisk.present) return { name, installed: null, latest, state: "missing" };
      if (!onDisk.version || !latest) {
        return { name, installed: onDisk.version, latest, state: "unknown" };
      }
      return {
        name,
        installed: onDisk.version,
        latest,
        state: compareSemver(onDisk.version, latest) < 0 ? "outdated" : "current",
      };
    }),
  );
  return statuses;
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
    const statuses = await checkUpdates();
    if (opts.json) {
      out(JSON.stringify({ packages: statuses }, null, 2));
      return 0;
    }
    if (statuses.length === 0) {
      hint("No @pify packages installed.");
      return 0;
    }
    const width = statuses.reduce((m, s) => Math.max(m, s.name.length), 0);
    for (const status of statuses) {
      const detail =
        status.state === "outdated"
          ? `${status.installed} → ${status.latest}`
          : status.state === "missing"
            ? "configured but not on disk"
            : status.state === "unknown"
              ? `${status.installed ?? "?"} (registry unreachable)`
              : `${status.installed}`;
      out(`  ${status.state.padEnd(9)}${status.name.padEnd(width + 2)}${detail}`);
    }
    const outdated = statuses.filter((s) => s.state === "outdated").length;
    out();
    out(outdated > 0 ? `${outdated} package(s) can be updated: pify update` : "Everything is current.");
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
