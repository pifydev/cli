import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isOffline } from "./exec.js";
import { notFoundError, usageError } from "./errors.js";

export interface CatalogPackage {
  /** Short name used on the pify command line, e.g. "goal". */
  name: string;
  /** Full npm name, e.g. "@pify/goal". */
  npm: string;
  repo: string;
  description: string;
  /** "published" once it exists on the npm registry; "planned" before that. */
  status: "published" | "planned";
  /**
   * npm packages that cannot run alongside this one — they register the same
   * command, tool, or flag, so pi loads both and one silently wins. Each entry
   * is documented in that package's own README (v0.4).
   */
  conflicts?: string[];
}

/** A named set of packages installable in one go, e.g. `pify install suite`. */
export interface CatalogBundle {
  name: string;
  description: string;
  packages: string[];
}

export interface Catalog {
  version: number;
  org: string;
  scope: string;
  /** URL of the always-current catalog on the org's main branch. */
  remote: string;
  packages: CatalogPackage[];
  /** Optional (v0.3): older CLIs ignore this key and keep working. */
  bundles?: CatalogBundle[];
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
 * SECURITY-CRITICAL. A fetched catalog is either fully valid or fully
 * discarded: every npm name must stay inside the @pify scope so a tampered
 * catalog cannot redirect installs outside the org (npm publish rights are a
 * separate credential from GitHub). Combined with the install rule that only
 * `npm:@pify/...` specs are ever delegated to pi, this bounds the blast
 * radius of a compromised remote to "packages the org itself published".
 */
export function validateCatalog(data: unknown): data is Catalog {
  if (typeof data !== "object" || data === null) return false;
  const c = data as Record<string, unknown>;
  if (!Number.isInteger(c.version)) return false;
  if (!Array.isArray(c.packages)) return false;
  for (const entry of c.packages) {
    if (typeof entry !== "object" || entry === null) return false;
    const p = entry as Record<string, unknown>;
    if (typeof p.name !== "string" || !/^[a-z0-9-]+$/.test(p.name)) return false;
    if (typeof p.npm !== "string" || !p.npm.startsWith("@pify/")) return false;
    if (p.status !== "published" && p.status !== "planned") return false;
    if (p.conflicts !== undefined) {
      if (!Array.isArray(p.conflicts)) return false;
      // A conflict entry names a package to warn about; it must never be a
      // vector for anything else, so only npm-name-shaped strings pass.
      if (!p.conflicts.every((c) => typeof c === "string" && /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(c))) {
        return false;
      }
    }
  }
  // Bundles are optional and must not be able to smuggle anything in: every
  // member has to be a package this same catalog already declares, so a
  // bundle can never widen what an install reaches.
  if (c.bundles !== undefined) {
    if (!Array.isArray(c.bundles)) return false;
    const known = new Set((c.packages as CatalogPackage[]).map((p) => p.name));
    for (const entry of c.bundles) {
      if (typeof entry !== "object" || entry === null) return false;
      const b = entry as Record<string, unknown>;
      if (typeof b.name !== "string" || !/^[a-z0-9-]+$/.test(b.name)) return false;
      if (typeof b.description !== "string") return false;
      if (!Array.isArray(b.packages) || b.packages.length === 0) return false;
      for (const member of b.packages) {
        if (typeof member !== "string" || !known.has(member)) return false;
      }
    }
  }
  return true;
}

/** The bundle by that name, or null. Package names always win over bundles. */
export function findBundle(catalog: Catalog, name: string): CatalogBundle | null {
  const wanted = name.trim().toLowerCase();
  if (catalog.packages.some((p) => p.name === wanted)) return null;
  return catalog.bundles?.find((b) => b.name === wanted) ?? null;
}

/**
 * Expand bundle names into their members, keeping order and dropping
 * duplicates — installing `suite goal` must not install goal twice.
 */
export function expandBundles(catalog: Catalog, names: string[]): string[] {
  const expanded: string[] = [];
  for (const name of names) {
    const bundle = findBundle(catalog, name);
    const members = bundle ? bundle.packages : [name];
    for (const member of members) {
      if (!expanded.includes(member)) expanded.push(member);
    }
  }
  return expanded;
}

/**
 * Load the catalog. Resolution chain, newest `version` wins:
 * bundled snapshot (offline floor) -> ~/.pify cache -> remote fetch.
 * Opportunistic refresh (3s timeout) when the cache is stale; forced refresh
 * (10s) via `refreshCatalog`. Every failure path falls back silently — the
 * catalog can never break a command.
 */
export async function loadCatalog(opts: { refresh?: boolean } = {}): Promise<Catalog> {
  const bundled = loadBundledCatalog();
  const cached = readCache();

  let remote = cached?.catalog ?? null;
  const stale = !cached || Date.now() - cached.fetchedAt > CACHE_TTL_MS;
  if (opts.refresh || stale) {
    const fetched = await fetchRemoteCatalog(bundled.remote, opts.refresh ? 10_000 : 3_000);
    if (fetched) {
      remote = fetched;
      writeCache(fetched);
    }
  }

  if (!remote || !validateCatalog(remote)) return bundled;
  return remote.version >= bundled.version ? remote : bundled;
}

/** Forced refresh for `pify update --catalog`. Reports success. */
export async function refreshCatalog(): Promise<{ ok: boolean; catalog: Catalog }> {
  const bundled = loadBundledCatalog();
  const fetched = await fetchRemoteCatalog(bundled.remote, 10_000);
  if (fetched) {
    writeCache(fetched);
    return { ok: true, catalog: fetched };
  }
  const cached = readCache();
  const fallback =
    cached && validateCatalog(cached.catalog) && cached.catalog.version >= bundled.version
      ? cached.catalog
      : bundled;
  return { ok: false, catalog: fallback };
}

async function fetchRemoteCatalog(defaultUrl: string, timeoutMs: number): Promise<Catalog | null> {
  if (isOffline()) return null;
  const url = process.env.PIFY_CATALOG_URL || defaultUrl;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return validateCatalog(data) ? data : null;
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
    const parsed = JSON.parse(readFileSync(cachePath(), "utf8")) as CacheEnvelope;
    if (typeof parsed.fetchedAt !== "number" || !validateCatalog(parsed.catalog)) return null;
    return parsed;
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

/** An exact version (1.2.3, 1.2.3-rc.1) or a dist-tag (latest, next). */
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const DIST_TAG = /^[a-z][a-z0-9._-]*$/i;

export interface InstallSpec {
  base: string;
  pin: string | null;
}

/** Split `goal@0.3.0` / `@pify/goal@next` into base and validated pin. */
export function parseInstallSpec(input: string): InstallSpec {
  const raw = input.startsWith("npm:") ? input.slice(4) : input;
  const at = raw.indexOf("@", raw.startsWith("@") ? 1 : 0);
  const base = at > 0 ? raw.slice(0, at) : raw;
  const pin = at > 0 ? raw.slice(at + 1) : null;
  if (pin !== null && !EXACT_VERSION.test(pin) && !(DIST_TAG.test(pin) && !/^\d/.test(pin))) {
    throw usageError(
      "Version pins must be exact versions or dist-tags.",
      `Got ${JSON.stringify(pin)} - ranges (^, ~, >, <, *, x) are not supported.`,
    );
  }
  return { base, pin };
}

export interface InstallTarget {
  shortName: string;
  npm: string;
  pin: string | null;
  /** True when the user typed the full @pify/<name> form (catalog bypass). */
  explicit: boolean;
  inCatalog: boolean;
  status: CatalogPackage["status"] | null;
  repo: string | null;
}

/**
 * Resolve a user-supplied install argument. Short names must exist in the
 * catalog and be published; the explicit `@pify/<name>` form always proceeds
 * (the escape hatch for catalog staleness — a truly unpublished package
 * degrades to pi/npm's own E404, never a wrong install). Anything outside the
 * @pify scope is refused: that is pi's job.
 */
export function resolveInstallTarget(catalog: Catalog, input: string): InstallTarget {
  const { base, pin } = parseInstallSpec(input);

  if (base.startsWith("@")) {
    if (!base.startsWith("@pify/")) {
      throw usageError(
        "pify installs @pify packages only.",
        `For other sources use: pi install ${input}`,
      );
    }
    const shortName = base.slice("@pify/".length).toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(shortName)) {
      throw usageError(`Invalid package name: ${JSON.stringify(base)}`);
    }
    const entry = catalog.packages.find((p) => p.name === shortName) ?? null;
    return {
      shortName,
      npm: `@pify/${shortName}`,
      pin,
      explicit: true,
      inCatalog: entry !== null,
      status: entry?.status ?? null,
      repo: entry?.repo ?? null,
    };
  }

  if (/[:/\\]/.test(base)) {
    throw usageError(
      "pify installs @pify packages only.",
      `For other sources use: pi install ${input}`,
    );
  }

  const needle = base.toLowerCase();
  const entry =
    catalog.packages.find((p) => p.name === needle || `pify-${p.name}` === needle) ?? null;
  if (!entry) {
    const names = catalog.packages.map((p) => p.name).join(", ");
    throw notFoundError(
      `Unknown pify package: ${JSON.stringify(input)}`,
      `Available: ${names}`,
    );
  }
  if (entry.status !== "published") {
    throw notFoundError(
      `@pify/${entry.name} is not published yet.`,
      `Track it at ${entry.repo}. Run "pify update --catalog" to refresh availability.`,
    );
  }
  return {
    shortName: entry.name,
    npm: entry.npm,
    pin,
    explicit: false,
    inCatalog: true,
    status: entry.status,
    repo: entry.repo,
  };
}

/**
 * Resolve a name for remove/update targeting: same input forms, but catalog
 * membership is not required (users must be able to remove packages later
 * dropped from the catalog). Pins are parsed and ignored.
 */
export function resolvePifyName(input: string): string {
  const { base } = parseInstallSpec(input);
  if (base.startsWith("@")) {
    if (!base.startsWith("@pify/")) {
      throw usageError(
        "pify manages @pify packages only.",
        `For other sources use the pi CLI directly.`,
      );
    }
    const shortName = base.slice("@pify/".length).toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(shortName)) {
      throw usageError(`Invalid package name: ${JSON.stringify(base)}`);
    }
    return shortName;
  }
  if (/[:/\\]/.test(base)) {
    throw usageError(
      "pify manages @pify packages only.",
      `For other sources use the pi CLI directly.`,
    );
  }
  const name = base.toLowerCase();
  return name.startsWith("pify-") ? name.slice("pify-".length) : name;
}
