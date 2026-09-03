import {
  piStatus,
  fetchLatestPiVersion,
  compareSemver,
  installPi,
  guardNpmManaged,
  officialInstallerCommand,
} from "../pi.js";
import { environmentError, PifyError, ExitCode } from "../errors.js";
import { isWindows, runOfficialInstaller } from "../exec.js";
import { out, success, hint, step, style } from "../ui.js";

export interface SetupOptions {
  force: boolean;
  piVersion?: string;
  installer: boolean;
}

/** Install the pi coding agent. Idempotent; the canonical first command. */
export async function setup(opts: SetupOptions): Promise<number> {
  if (opts.installer) {
    // Delegate to pi's official interactive installer for this OS. It can
    // bootstrap Node itself and (on Windows) install Git Bash, which the
    // non-interactive npm path cannot.
    if (!process.stdin.isTTY || process.env.CI) {
      throw environmentError(
        "The official installer is interactive and needs a terminal.",
        "In CI, use plain `pify setup` (non-interactive npm path) instead.",
      );
    }
    step(officialInstallerCommand());
    const code = await runOfficialInstaller(isWindows ? "windows" : "posix");
    if (code !== 0) {
      throw new PifyError(`The official installer exited with code ${code}.`, ExitCode.SUBPROCESS);
    }
    return 0;
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
