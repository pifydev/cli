import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  interpolate,
  packageJsonTemplate,
  INDEX_TS,
  TSCONFIG_JSON,
  GITIGNORE,
  README_MD,
  type TemplateVars,
} from "../templates.js";
import { TESTED_PI_VERSION } from "../pi.js";
import { usageError, PifyError, ExitCode } from "../errors.js";
import { out, success, hint } from "../ui.js";

export interface InitOptions {
  name?: string;
  description?: string;
}

/** npm's package-name grammar. */
const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/**
 * Scaffold a correctly-shaped Pi Package. No prompts, no git init, no npm
 * install — flags and defaults only, fully CI-safe. The templates encode the
 * ecosystem rules published packages routinely get wrong: host packages as
 * optional peerDependencies, raw .ts in the files allowlist (no build step),
 * lifecycle-correct factory.
 */
export async function init(dirArg: string | undefined, opts: InitOptions): Promise<number> {
  const dir = dirArg ?? ".";
  const target = resolve(dir);

  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new PifyError(
      `Target directory ${JSON.stringify(dir)} is not empty.`,
      ExitCode.FAILURE,
      "Choose a new directory: pify init my-extension",
    );
  }

  const name = (opts.name ?? basename(target)).toLowerCase();
  if (!NPM_NAME.test(name)) {
    throw usageError(
      `Invalid npm package name: ${JSON.stringify(name)}`,
      "Pass a valid name explicitly: pify init <dir> --name my-pi-package",
    );
  }

  const shortName = name.includes("/") ? name.split("/")[1]! : name;
  const vars: TemplateVars = {
    name,
    description: opts.description ?? "A Pi Package for the pi coding agent.",
    shortName,
    snakeName: shortName.replace(/-/g, "_").replace(/[^a-z0-9_]/g, "_"),
    piVersion: TESTED_PI_VERSION,
    dir: basename(target),
  };

  mkdirSync(target, { recursive: true });

  const files: Array<[string, string]> = [
    ["package.json", interpolate(packageJsonTemplate(name.startsWith("@")), vars)],
    ["index.ts", interpolate(INDEX_TS, vars)],
    ["tsconfig.json", TSCONFIG_JSON],
    [".gitignore", GITIGNORE],
    ["README.md", interpolate(README_MD, vars)],
  ];
  for (const [file, content] of files) {
    writeFileSync(join(target, file), content);
  }

  success(`Created ${files.length} files in ${basename(target)}/`);
  for (const [file] of files) out(`  ${file}`);
  out();
  hint("Next steps:");
  hint(`  cd ${basename(target)} && npm install`);
  hint(`  pi install ./${basename(target)}   # register locally; hot-reloads with /reload`);
  hint(`  pi -e ./${basename(target)}/index.ts   # or load ad hoc for a single run`);
  return 0;
}
