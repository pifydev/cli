import { installPi, piStatus, latestVersion, PI_PACKAGE, compareSemver } from "../pi.js";
import { success, info, style } from "../ui.js";

export interface SetupOptions {
  force: boolean;
}

/** Install the pi coding agent if missing; report status otherwise. */
export async function setup(opts: SetupOptions): Promise<number> {
  const st = piStatus();

  if (st.installed && !opts.force) {
    success(`pi ${st.version ?? "(unknown version)"} is already installed at ${st.binPath}`);
    const latest = latestVersion(PI_PACKAGE);
    if (latest && st.version && compareSemver(st.version, latest) < 0) {
      info(`  ${style.yellow(`Update available: ${st.version} -> ${latest}`)} — run ${style.bold("pify update pi")}`);
    }
    info(`  Next: ${style.bold("pify list")} to see available packages.`);
    return 0;
  }

  await installPi();
  info(`  Next: ${style.bold("pify list")} to see available packages.`);
  return 0;
}
