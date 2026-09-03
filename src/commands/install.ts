import { loadCatalog, resolveInstallTarget, type InstallTarget } from "../catalog.js";
import { delegate, requirePi } from "../pi.js";
import { usageError, PifyError, ExitCode } from "../errors.js";
import { out, step, warn } from "../ui.js";

export interface InstallOptions {
  local: boolean;
  approve: boolean;
  dryRun: boolean;
}

function piArgs(target: InstallTarget, opts: InstallOptions): string[] {
  const spec = target.pin ? `npm:${target.npm}@${target.pin}` : `npm:${target.npm}`;
  const args = ["install", spec];
  if (opts.local) args.push("-l");
  if (opts.approve) args.push("-a");
  return args;
}

/**
 * Install @pify packages by short name; the install itself is delegated to
 * `pi install`, which owns the settings write, locking, dedupe, the npm
 * install into pi's extension root, and the project-trust decision.
 */
export async function install(names: string[], opts: InstallOptions): Promise<number> {
  if (names.length === 0) {
    throw usageError("Missing package name.", "Usage: pify install <name...> [-l] [-a]");
  }

  const catalog = await loadCatalog();

  // Resolve every name before doing anything: a typo never leaves a
  // half-applied multi-install. Throws exit 2/4 on the first bad name.
  const targets = names.map((name) => resolveInstallTarget(catalog, name));

  for (const target of targets) {
    if (target.explicit && (!target.inCatalog || target.status !== "published")) {
      // Escape hatch for catalog staleness: a truly unpublished package
      // degrades to pi/npm's own E404, never a wrong install.
      warn(`${target.npm} is not in the catalog (or not marked published); installing anyway.`);
    }
  }

  requirePi();

  if (opts.dryRun) {
    for (const target of targets) out(`pi ${piArgs(target, opts).join(" ")}`);
    return 0;
  }

  const failed: string[] = [];
  for (const target of targets) {
    const args = piArgs(target, opts);
    step(`pi ${args.join(" ")}`);
    const code = await delegate(args);
    if (code !== 0) failed.push(target.shortName);
  }

  if (failed.length > 0) {
    throw new PifyError(
      `Installed ${targets.length - failed.length} of ${targets.length}; failed: ${failed.join(", ")}`,
      ExitCode.SUBPROCESS,
    );
  }
  return 0;
}
