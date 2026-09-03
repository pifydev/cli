import {
  piStatus,
  fetchLatestPiVersion,
  compareSemver,
  installPi,
  guardNpmManaged,
  assertNodeVersion,
} from "../pi.js";
import { environmentError } from "../errors.js";
import { which } from "../exec.js";
import { out, success, hint, style } from "../ui.js";

export interface SetupOptions {
  force: boolean;
  piVersion?: string;
}

/** Install the pi coding agent. Idempotent; the canonical first command. */
export async function setup(opts: SetupOptions): Promise<number> {
  assertNodeVersion();
  if (!which("npm")) {
    throw environmentError(
      "npm was not found on PATH.",
      "Install Node.js (which bundles npm) from https://nodejs.org and retry.",
    );
  }

  const st = piStatus();

  if (st.installed && !opts.force && !opts.piVersion) {
    success(`pi ${st.version ?? "(unknown version)"} is already installed at ${st.binPath}`);
    const latest = await fetchLatestPiVersion();
    if (latest && st.version && compareSemver(st.version, latest) < 0) {
      out(style.yellow(`Update available: ${st.version} -> ${latest} - run pify update pi`));
    }
    hint("Next: pify list to see available packages.");
    return 0;
  }

  if (st.installed && opts.piVersion && st.version === opts.piVersion) {
    success(`pi ${opts.piVersion} is already installed.`);
    return 0;
  }

  // The only cases pify ever runs npm -g over an existing pi: --force or an
  // explicit version target (pi's own updater cannot target arbitrary
  // versions). Both require evidence the existing install is npm-managed.
  if (st.installed && st.binPath) {
    guardNpmManaged(st.binPath);
  }

  await installPi(opts.piVersion);
  hint("Next: pify list to see available packages.");
  return 0;
}
