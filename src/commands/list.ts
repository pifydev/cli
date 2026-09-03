import { loadCatalog } from "../catalog.js";
import { installedSources } from "../pi.js";
import { out, style } from "../ui.js";

/** Show the @pify catalog annotated with local install state. */
export async function list(): Promise<number> {
  const catalog = await loadCatalog();
  const installed = installedSources();

  out(style.bold(`@pify packages (${catalog.org})`));
  out();

  const width = catalog.packages.reduce((m, p) => Math.max(m, p.name.length), 0);
  for (const pkg of catalog.packages) {
    const scope = installed.get(`npm:${pkg.npm}`);
    // Pad the plain text first; ANSI escapes would throw off padEnd.
    const [text, paint] = scope
      ? ([scope === "project" ? "◉ project" : "◉ installed", style.green] as const)
      : pkg.status === "published"
        ? (["○ available", style.dim] as const)
        : (["· planned", style.dim] as const);
    out(`  ${pkg.name.padEnd(width)}  ${paint(text.padEnd(12))}${style.dim(pkg.description)}`);
  }

  out();
  out(style.dim("Install with: pify install <name>   (e.g. pify install goal)"));
  return 0;
}
