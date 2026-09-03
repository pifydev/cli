/**
 * Programmatic surface of @pify/cli. The binary lives in cli.ts;
 * this module is for tooling that wants the same primitives.
 */
export { loadCatalog, loadBundledCatalog, resolvePackage } from "./catalog.js";
export type { Catalog, CatalogPackage } from "./catalog.js";
export {
  piStatus,
  installPi,
  updatePi,
  readSettings,
  installedSources,
  compareSemver,
  PI_PACKAGE,
  NODE_FLOOR,
} from "./pi.js";
export { assertSafeArg } from "./exec.js";
export type { PiStatus, PiSettings } from "./pi.js";
export { PifyError, ExitCode } from "./errors.js";
