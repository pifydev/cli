import { loadCatalog } from "../catalog.js";
import { installedPifyPackages, installedVersionOnDisk } from "../pi.js";
import { out, hint, style } from "../ui.js";

export interface ListOptions {
  json: boolean;
}

interface Row {
  name: string;
  npm: string;
  description: string;
  repo: string | null;
  status: "published" | "planned" | null;
  installed: {
    scope: "user" | "project";
    version: string | null;
    pinned: boolean;
    missingOnDisk: boolean;
  } | null;
}

/**
 * Show the full @pify catalog annotated with local install state — the
 * discovery surface `pi list` cannot provide (pi lists what IS installed;
 * pify lists what EXISTS and what is coming). Always exits 0.
 */
export async function list(opts: ListOptions): Promise<number> {
  const catalog = await loadCatalog();
  const installed = installedPifyPackages();

  const rows: Row[] = catalog.packages.map((pkg) => {
    const entry = installed.get(pkg.name);
    if (!entry) {
      return { name: pkg.name, npm: pkg.npm, description: pkg.description, repo: pkg.repo, status: pkg.status, installed: null };
    }
    const disk = installedVersionOnDisk(pkg.name, entry.scope);
    return {
      name: pkg.name,
      npm: pkg.npm,
      description: pkg.description,
      repo: pkg.repo,
      status: pkg.status,
      installed: {
        scope: entry.scope,
        version: disk.version,
        pinned: entry.pin !== null,
        missingOnDisk: !disk.present,
      },
    };
  });

  // Installed @pify packages that fell out of (or never entered) the catalog.
  for (const [name, entry] of installed) {
    if (rows.some((r) => r.name === name)) continue;
    const disk = installedVersionOnDisk(name, entry.scope);
    rows.push({
      name,
      npm: `@pify/${name}`,
      description: "(not in catalog)",
      repo: null,
      status: null,
      installed: {
        scope: entry.scope,
        version: disk.version,
        pinned: entry.pin !== null,
        missingOnDisk: !disk.present,
      },
    });
  }

  if (opts.json) {
    out(JSON.stringify(rows, null, 2));
    return 0;
  }

  out(style.bold(`@pify packages (${catalog.org})`));
  out();

  const nameWidth = rows.reduce((m, r) => Math.max(m, r.name.length), 0) + 2;
  const stateOf = (r: Row): { text: string; paint: (s: string) => string } => {
    if (r.installed) {
      if (r.installed.missingOnDisk) {
        return { text: `missing on disk (${r.installed.scope})`, paint: style.red };
      }
      const ver = r.installed.version ?? "?";
      const pin = r.installed.pinned ? " pinned" : "";
      return { text: `installed ${ver} (${r.installed.scope})${pin}`, paint: style.green };
    }
    if (r.status === "published") return { text: "available", paint: (s) => s };
    return { text: "planned", paint: style.dim };
  };

  const stateWidth = rows.reduce((m, r) => Math.max(m, stateOf(r).text.length), 0) + 2;
  for (const r of rows) {
    const { text, paint } = stateOf(r);
    // Pad plain text before ANSI wrapping; escapes would break padEnd.
    out(`  ${r.name.padEnd(nameWidth)}${paint(text.padEnd(stateWidth))}${style.dim(r.description)}`);
  }

  out();
  hint("Install with: pify install <name>");
  return 0;
}
