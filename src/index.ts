/**
 * Programmatic surface of @pify/cli. The binary lives in cli.ts;
 * this module is for org tooling and tests that want the same primitives.
 */
export { VERSION } from "./version.js";
export {
  loadCatalog,
  loadBundledCatalog,
  refreshCatalog,
  validateCatalog,
  parseInstallSpec,
  resolveInstallTarget,
  resolvePifyName,
} from "./catalog.js";
export type { Catalog, CatalogPackage, InstallSpec, InstallTarget } from "./catalog.js";
export {
  piStatus,
  fetchLatestPiVersion,
  installPi,
  updatePi,
  readSettings,
  installedPifyPackages,
  installedVersionOnDisk,
  agentDir,
  compareSemver,
  npmInstallPiArgs,
  officialInstallerCommand,
  PI_PACKAGE,
  NODE_FLOOR,
  TESTED_PI_VERSION,
} from "./pi.js";
export type { PiStatus, PiSettings, InstalledPifyPackage } from "./pi.js";
export { assertSafeArg, which, isOffline } from "./exec.js";
export { interpolate, packageJsonTemplate, INDEX_TS, README_MD } from "./templates.js";
export type { TemplateVars } from "./templates.js";
export { PifyError, ExitCode } from "./errors.js";
