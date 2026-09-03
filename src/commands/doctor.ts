import { existsSync } from "node:fs";
import { isOffline, isWindows, runCapture, which } from "../exec.js";
import {
  piStatus,
  fetchLatestPiVersion,
  compareSemver,
  npmPrefixEvidence,
  readSettings,
  settingsPath,
  installedPifyPackages,
  installedVersionOnDisk,
  agentDir,
  NODE_FLOOR,
} from "../pi.js";
import { out, style } from "../ui.js";
import { VERSION } from "../version.js";

export interface DoctorOptions {
  json: boolean;
}

type Status = "ok" | "warn" | "fail" | "info";
interface Check {
  id: string;
  status: Status;
  detail: string;
}

/** Diagnose the environment. Read-only. Exit 0 healthy (warns allowed), 1 not. */
export async function doctor(opts: DoctorOptions): Promise<number> {
  const checks: Check[] = [];
  const push = (id: string, status: Status, detail: string) => checks.push({ id, status, detail });

  // 1. node
  const nodeOk = compareSemver(process.versions.node, NODE_FLOOR) >= 0;
  push(
    "node",
    nodeOk ? "ok" : "fail",
    nodeOk
      ? `v${process.versions.node} (>= ${NODE_FLOOR} required)`
      : `v${process.versions.node} - pi requires >= ${NODE_FLOOR}; upgrade Node`,
  );

  // 2. npm
  const npmPath = which("npm");
  if (npmPath) {
    const ver = runCapture("npm", ["--version"]);
    push("npm", "ok", `${ver.status === 0 ? `v${ver.stdout.trim()} at ` : ""}${npmPath}`);
  } else {
    push("npm", "fail", "not found on PATH - install Node.js from https://nodejs.org");
  }

  // 3. git (warn only: pi's git: sources need it, nothing else does)
  const gitPath = which("git");
  push(
    "git",
    gitPath ? "ok" : "warn",
    gitPath ?? "git not found - pi's git: package sources will not work",
  );

  // 3b. bash on Windows: pi's bash tool requires Git Bash there.
  if (isWindows) {
    const bashPath = which("bash");
    push(
      "bash",
      bashPath ? "ok" : "warn",
      bashPath ?? "bash not found - pi needs Git Bash on Windows; run pify setup --installer",
    );
  }

  // 4. pi
  const pi = piStatus();
  if (!pi.installed) {
    push("pi", "fail", "not installed - run: pify setup");
  } else if (!pi.version) {
    push("pi", "fail", `pi found at ${pi.binPath} but "pi --version" failed (broken install)`);
  } else {
    push("pi", "ok", `pi ${pi.version} at ${pi.binPath}`);
  }

  // 5. pi-latest
  if (isOffline()) {
    push("pi-latest", "info", "skipped (offline)");
  } else {
    const latest = await fetchLatestPiVersion();
    if (!latest) {
      push("pi-latest", "warn", "could not reach pi.dev to check the latest version");
    } else if (pi.version && compareSemver(pi.version, latest) < 0) {
      push("pi-latest", "warn", `pi ${pi.version} installed, ${latest} available - run pify update pi`);
    } else {
      push("pi-latest", "ok", `pi ${latest} is current`);
    }
  }

  // 6. pi-install-method (info only; self-update is delegated to pi anyway)
  if (process.env.PI_MANAGED_INSTALL_ROOT) {
    push("pi-install-method", "info", "managed install (PI_MANAGED_INSTALL_ROOT)");
  } else if (pi.binPath) {
    const { managed, prefix } = npmPrefixEvidence(pi.binPath);
    push(
      "pi-install-method",
      "info",
      managed ? `npm global (${prefix})` : "unrecognized (self-update is delegated to pi either way)",
    );
  } else {
    push("pi-install-method", "info", "n/a (pi not installed)");
  }

  // 7-8. settings files
  for (const scope of ["user", "project"] as const) {
    const id = scope === "user" ? "settings-user" : "settings-project";
    const path = settingsPath(scope);
    if (!existsSync(path)) {
      push(id, "info", scope === "user" ? "not found (run pi once to create it)" : "none");
      continue;
    }
    const settings = readSettings(scope);
    if (settings === null) {
      push(id, "warn", `${path} is unparseable JSON`);
    } else {
      push(id, "ok", `${path} (${settings.packages?.length ?? 0} packages configured)`);
    }
  }

  // 9. @pify packages on disk
  const installed = installedPifyPackages();
  if (installed.size === 0) {
    push("pify-packages", "info", "no @pify packages configured yet");
  } else {
    const missing = [...installed.values()].filter(
      (p) => !installedVersionOnDisk(p.name, p.scope).present,
    );
    if (missing.length > 0) {
      push(
        "pify-packages",
        "fail",
        `missing on disk: ${missing.map((p) => p.name).join(", ")} - run pify install <name> to repair`,
      );
    } else {
      push("pify-packages", "ok", `${installed.size} configured, all present on disk`);
    }
  }

  // 10. env
  const envVars = ["PI_OFFLINE", "PIFY_OFFLINE", "PI_CODING_AGENT_DIR", "NO_COLOR", "PIFY_CATALOG_URL"]
    .filter((name) => process.env[name] !== undefined)
    .map((name) => `${name}=${process.env[name]}`);
  push("env", "info", envVars.length > 0 ? envVars.join(", ") : "none set");

  const problems = checks.filter((c) => c.status === "fail").length;

  if (opts.json) {
    out(JSON.stringify({ pify: VERSION, agentDir: agentDir(), checks, problems }, null, 2));
    return problems > 0 ? 1 : 0;
  }

  out(style.bold("pify doctor"));
  out();
  const paint: Record<Status, (s: string) => string> = {
    ok: style.green,
    warn: style.yellow,
    fail: style.red,
    info: style.dim,
  };
  const idWidth = checks.reduce((m, c) => Math.max(m, c.id.length), 0) + 2;
  for (const c of checks) {
    out(`  ${paint[c.status](c.status.padEnd(6))}${c.id.padEnd(idWidth)}${style.dim(c.detail)}`);
  }
  out();
  if (problems > 0) {
    out(style.red(`${problems} problem${problems > 1 ? "s" : ""} found.`));
    return 1;
  }
  out(style.green("Everything looks good."));
  return 0;
}
