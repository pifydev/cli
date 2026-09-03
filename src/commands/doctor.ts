import { which, isWindows } from "../exec.js";
import {
  piStatus,
  latestVersion,
  compareSemver,
  readSettings,
  installedSources,
  PI_PACKAGE,
  NODE_FLOOR,
} from "../pi.js";
import { loadBundledCatalog } from "../catalog.js";
import { out, style } from "../ui.js";

type CheckResult = { ok: boolean; label: string; detail: string };

/** Environment diagnosis. Exit 0 when healthy, 1 when any check fails. */
export async function doctor(): Promise<number> {
  const checks: CheckResult[] = [];

  const nodeOk = compareSemver(process.versions.node, NODE_FLOOR) >= 0;
  checks.push({
    ok: nodeOk,
    label: "node",
    detail: nodeOk
      ? `v${process.versions.node} (>= ${NODE_FLOOR} required)`
      : `v${process.versions.node} — pi requires >= ${NODE_FLOOR}`,
  });

  const npmPath = which("npm");
  checks.push({
    ok: Boolean(npmPath),
    label: "npm",
    detail: npmPath ?? "not found on PATH — install Node.js from https://nodejs.org",
  });

  const pi = piStatus();
  if (!pi.installed) {
    checks.push({ ok: false, label: "pi", detail: "not installed — run `pify setup`" });
  } else {
    const latest = latestVersion(PI_PACKAGE);
    const behind = latest && pi.version && compareSemver(pi.version, latest) < 0;
    checks.push({
      ok: true,
      label: "pi",
      detail: behind
        ? `${pi.version} at ${pi.binPath} (latest: ${latest} — run \`pify update pi\`)`
        : `${pi.version ?? "unknown"} at ${pi.binPath}`,
    });
  }

  const userSettings = readSettings("user");
  checks.push({
    ok: true,
    label: "settings",
    detail: userSettings
      ? `~/.pi/agent/settings.json (${userSettings.packages?.length ?? 0} packages)`
      : "no user settings yet (created on first `pi install`)",
  });

  const catalog = loadBundledCatalog();
  const installed = installedSources();
  const ours = catalog.packages.filter((p) => installed.has(`npm:${p.npm}`));
  checks.push({
    ok: true,
    label: "@pify",
    detail:
      ours.length > 0
        ? `${ours.length} installed: ${ours.map((p) => p.name).join(", ")}`
        : "no @pify packages installed yet",
  });

  if (isWindows) {
    checks.push({
      ok: true,
      label: "platform",
      detail: "Windows — subprocesses delegate through cmd shims (expected)",
    });
  }

  out(style.bold("pify doctor"));
  out();
  const width = checks.reduce((m, c) => Math.max(m, c.label.length), 0);
  for (const c of checks) {
    const mark = c.ok ? style.green("✓") : style.red("✗");
    out(`  ${mark} ${c.label.padEnd(width)}  ${c.ok ? style.dim(c.detail) : c.detail}`);
  }
  out();

  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    out(style.red(`${failed.length} problem${failed.length > 1 ? "s" : ""} found.`));
    return 1;
  }
  out(style.green("Everything looks good."));
  return 0;
}
