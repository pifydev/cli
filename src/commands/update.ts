import { loadCatalog, refreshCatalog, resolvePifyName } from "../catalog.js";
import { delegate, installedPifyPackages, installPi, piStatus } from "../pi.js";
import { isOffline } from "../exec.js";
import { usageError, notFoundError, PifyError, ExitCode } from "../errors.js";
import { out, step, success, hint, warn } from "../ui.js";

export interface UpdateOptions {
  catalogOnly: boolean;
  dryRun: boolean;
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
