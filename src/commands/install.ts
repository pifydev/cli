import { loadCatalog, resolvePackage } from "../catalog.js";
import { delegate } from "../pi.js";
import { usageError, notFoundError, PifyError, ExitCode } from "../errors.js";
import { step, warn } from "../ui.js";

export interface InstallOptions {
  local: boolean;
}

/**
 * Install one or more @pify packages by delegating to `pi install`.
 * pi owns settings.json and the npm workspace; we only translate names.
 */
export async function install(names: string[], opts: InstallOptions): Promise<number> {
  if (names.length === 0) {
    throw usageError("Nothing to install.", "Usage: pify install <package...>   e.g. pify install goal memory");
  }

  const catalog = await loadCatalog();
  const targets = names.map((n) => resolvePackage(catalog, n));

  const planned = targets.filter((t) => t.status !== "published");
  if (planned.length > 0) {
    for (const t of planned) {
      warn(`${t.npm} is not published yet (${t.repo}).`);
    }
    throw notFoundError(
      `Not yet available on npm: ${planned.map((t) => t.name).join(", ")}`,
      "Run `pify update --catalog` later to refresh availability.",
    );
  }

  for (const target of targets) {
    const source = `npm:${target.npm}`;
    step(`pi install ${source}${opts.local ? " -l" : ""}`);
    const args = ["install", source];
    if (opts.local) args.push("-l");
    const code = await delegate(args);
    if (code !== 0) {
      throw new PifyError(`pi install ${source} exited with code ${code}.`, ExitCode.SUBPROCESS);
    }
  }
  return 0;
}

/** Remove installed @pify packages via `pi remove`. */
export async function remove(names: string[], opts: InstallOptions): Promise<number> {
  if (names.length === 0) {
    throw usageError("Nothing to remove.", "Usage: pify remove <package...>");
  }
  const catalog = await loadCatalog();
  for (const name of names) {
    const target = resolvePackage(catalog, name);
    const source = `npm:${target.npm}`;
    step(`pi remove ${source}${opts.local ? " -l" : ""}`);
    const args = ["remove", source];
    if (opts.local) args.push("-l");
    const code = await delegate(args);
    if (code !== 0) {
      throw new PifyError(`pi remove ${source} exited with code ${code}.`, ExitCode.SUBPROCESS);
    }
  }
  return 0;
}
