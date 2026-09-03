import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** CLI version, read from the packaged package.json (always in the tarball). */
export const VERSION: string = (require("../package.json") as { version: string }).version;
