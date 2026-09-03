import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { notFoundError } from "./errors.js";

export interface CatalogPackage {
  /** Short name used on the pify command line, e.g. "goal". */
  name: string;
  /** Full npm name, e.g. "@pify/goal". */
  npm: string;
  repo: string;
  description: string;
  /** "published" once it exists on the npm registry; "planned" before that. */
  status: "published" | "planned";
}

export interface Catalog {
  version: number;
  org: string;
  scope: string;
  /** URL of the always-current catalog on the org's main branch. */
  remote: string;
  packages: CatalogPackage[];
}

/** catalog.json ships at the package root, one level above dist/. */
function bundledCatalogPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "catalog.json");
}

function cachePath(): string {
  return join(homedir(), ".pify", "catalog.json");
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function loadBundledCatalog(): Catalog {
  return JSON.parse(readFileSync(bundledCatalogPath(), "utf8")) as Catalog;
}

/**
 * The bundled catalog is the source of truth for what exists; the remote
 * catalog (refreshed at most daily, silently skipped offline) picks up
 * packages published after this CLI version shipped. Newest version wins.
 */
export async function loadCatalog(opts: { refresh?: boolean } = {}): Promise<Catalog> {
  const bundled = loadBundledCatalog();
  const cached = readCache();

  let remote = cached?.catalog ?? null;
  const stale = !cached || Date.now() - cached.fetchedAt > CACHE_TTL_MS;
  if (opts.refresh || stale) {
    const fetched = await fetchRemoteCatalog(bundled.remote);
    if (fetched) {
      remote = fetched;
      writeCache(fetched);
    }
  }

  if (!remote) return bundled;
  return remote.version >= bundled.version ? remote : bundled;
}

async function fetchRemoteCatalog(url: string): Promise<Catalog | null> {
  if (process.env.PIFY_OFFLINE === "1" || process.env.PI_OFFLINE === "1") return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as Catalog;
    if (!Array.isArray(data.packages) || typeof data.version !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

interface CacheEnvelope {
  fetchedAt: number;
  catalog: Catalog;
}

function readCache(): CacheEnvelope | null {
  try {
    statSync(cachePath());
    return JSON.parse(readFileSync(cachePath(), "utf8")) as CacheEnvelope;
  } catch {
    return null;
  }
}

function writeCache(catalog: Catalog): void {
  try {
    mkdirSync(dirname(cachePath()), { recursive: true });
    writeFileSync(cachePath(), JSON.stringify({ fetchedAt: Date.now(), catalog }, null, 2));
  } catch {
    // A failed cache write must never break a command.
  }
}

/**
 * Resolve a user-supplied name to a catalog entry. Accepts the short name
 * ("goal"), the npm name ("@pify/goal"), or a bare "pify-" prefix slip.
 */
export function resolvePackage(catalog: Catalog, input: string): CatalogPackage {
  const needle = input.toLowerCase();
  const found = catalog.packages.find(
    (p) =>
      p.name === needle ||
      p.npm.toLowerCase() === needle ||
      `pify-${p.name}` === needle,
  );
  if (!found) {
    const names = catalog.packages.map((p) => p.name).join(", ");
    throw notFoundError(
      `Unknown pify package: ${JSON.stringify(input)}`,
      `Available: ${names}`,
    );
  }
  return found;
}
