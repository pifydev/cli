import { resolvePifyName } from "../catalog.js";
import { delegate, readSettings, requirePi } from "../pi.js";
import { usageError, notFoundError, PifyError, ExitCode } from "../errors.js";
import { out, step } from "../ui.js";

export interface RemoveOptions {
  local: boolean;
  approve: boolean;
  dryRun: boolean;
}

const PIFY_SOURCE = /^npm:@pify\/([A-Za-z0-9._-]+?)(?:@.+)?$/;

/** @pify names configured in the settings scope pi would target. */
function configuredNames(scope: "user" | "project"): Set<string> {
  const names = new Set<string>();
  for (const entry of readSettings(scope)?.packages ?? []) {
    const source = typeof entry === "string" ? entry : entry.source;
    if (typeof source !== "string") continue;
    const name = PIFY_SOURCE.exec(source)?.[1];
    if (name) names.add(name);
  }
  return names;
}

/** Remove installed @pify packages by short name via `pi remove`. */
export async function remove(names: string[], opts: RemoveOptions): Promise<number> {
  if (names.length === 0) {
    throw usageError("Missing package name.", "Usage: pify remove <name...> [-l] [-a]");
  }

  // Catalog membership is NOT required: users must be able to remove
  // packages later dropped from the catalog.
  const targets = names.map(resolvePifyName);

  // Read-only pre-check for error quality; pi still owns the actual removal.
  const scope = opts.local ? "project" : "user";
  const installed = configuredNames(scope);
  for (const name of targets) {
    if (!installed.has(name)) {
      const scopeNote = opts.local ? " in project scope" : "";
      throw notFoundError(
        `${name} is not installed${scopeNote}.`,
        installed.size > 0
          ? `Installed @pify packages: ${[...installed].sort().join(", ")}`
          : "Nothing from @pify is installed.",
      );
    }
  }

  requirePi();

  const argsFor = (name: string) => {
    const args = ["remove", `npm:@pify/${name}`];
    if (opts.local) args.push("-l");
    if (opts.approve) args.push("-a");
    return args;
  };

  if (opts.dryRun) {
    for (const name of targets) out(`pi ${argsFor(name).join(" ")}`);
    return 0;
  }

  const failed: string[] = [];
  for (const name of targets) {
    const args = argsFor(name);
    step(`pi ${args.join(" ")}`);
    const code = await delegate(args);
    if (code !== 0) failed.push(name);
  }

  if (failed.length > 0) {
    throw new PifyError(
      `Removed ${targets.length - failed.length} of ${targets.length}; failed: ${failed.join(", ")}`,
      ExitCode.SUBPROCESS,
    );
  }
  return 0;
}
