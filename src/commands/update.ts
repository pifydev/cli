import { loadCatalog, resolvePackage } from "../catalog.js";
import { updatePi, delegate, installedSources, piStatus } from "../pi.js";
import { PifyError, ExitCode } from "../errors.js";
import { step, success, info, style } from "../ui.js";

export interface UpdateOptions {
  /** Refresh the remote catalog only. */
  catalogOnly: boolean;
}

/**
 * `pify update`            -> update pi itself, then every installed @pify package
 * `pify update pi`         -> pi only
 * `pify update <pkg...>`   -> those packages only
 * `pify update --catalog`  -> refresh the package catalog only
 */
export async function update(targets: string[], opts: UpdateOptions): Promise<number> {
  if (opts.catalogOnly) {
    step("Refreshing package catalog...");
    await loadCatalog({ refresh: true });
    success("Catalog refreshed.");
    return 0;
  }

  const piOnly = targets.length === 1 && (targets[0] === "pi" || targets[0] === "self");
  const updateEverything = targets.length === 0;

  if (piOnly || updateEverything) {
    await updatePi();
    if (piOnly) return 0;
  }

  const catalog = await loadCatalog({ refresh: updateEverything });
  const installed = installedSources();

  let sources: string[];
  if (updateEverything) {
    sources = [...installed.keys()].filter((s) =>
      catalog.packages.some((p) => s === `npm:${p.npm}`),
    );
    if (sources.length === 0) {
      info(style.dim("No @pify packages installed; nothing more to update."));
      return 0;
    }
  } else {
    sources = targets.map((t) => `npm:${resolvePackage(catalog, t).npm}`);
  }

  if (!piStatus().installed) {
    throw new PifyError("pi is required to update packages.", ExitCode.ENVIRONMENT, "Run `pify setup` first.");
  }

  for (const source of sources) {
    step(`pi update --extension ${source}`);
    const code = await delegate(["update", "--extension", source]);
    if (code !== 0) {
      throw new PifyError(`pi update --extension ${source} exited with code ${code}.`, ExitCode.SUBPROCESS);
    }
  }
  return 0;
}
