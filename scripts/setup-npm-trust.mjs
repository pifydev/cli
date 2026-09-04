#!/usr/bin/env node
/**
 * Configure npm Trusted Publishers (OIDC) for every @pify package in one pass
 * (pattern from oh-my-pi's setup-npm-trust). The npm website makes you do this
 * by hand per package; this drives `npm trust github` over the whole suite.
 *
 * Run LOCALLY (npm trust is interactive — web 2FA), never in CI:
 *   node scripts/setup-npm-trust.mjs [--dry-run]
 *
 * After every package reports trusted, the org-level NPM_TOKEN secret can be
 * deleted and each repo's release.yml switched to OIDC (see pifydev/cli's
 * release.yml for the template: id-token: write, npm >= 11.5.1, bare
 * `npm publish`).
 */
import { execSync, spawnSync } from "node:child_process";

const ORG = "pifydev";
const WORKFLOW = "release.yml";
const PACKAGES = [
  ["@pify/cli", "cli"],
  ["@pify/btw", "btw"],
  ["@pify/goal", "goal"],
  ["@pify/memory", "memory"],
  ["@pify/plan-mode", "plan-mode"],
  ["@pify/pretty", "pretty"],
  ["@pify/subagent", "subagent"],
  ["@pify/swarm", "swarm"],
  ["@pify/task", "task"],
  ["@pify/usage", "usage"],
  ["@pify/workflow", "workflow"],
  ["@pify/yolo", "yolo"],
];

const dryRun = process.argv.includes("--dry-run");
const shell = process.platform === "win32";

function alreadyTrusted(pkg) {
  try {
    const output = execSync(`npm trust list ${pkg} --json`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell,
    });
    const parsed = JSON.parse(output);
    const entries = Array.isArray(parsed) ? parsed : (parsed?.trusts ?? []);
    return entries.length > 0;
  } catch {
    return false;
  }
}

let failures = 0;
for (const [pkg, repo] of PACKAGES) {
  const args = [
    "trust",
    "github",
    pkg,
    "--repo",
    `${ORG}/${repo}`,
    "--file",
    `.github/workflows/${WORKFLOW}`,
    "--allow-publish",
    "--yes",
  ];
  if (dryRun) {
    console.log(`npm ${args.join(" ")}`);
    continue;
  }
  if (alreadyTrusted(pkg)) {
    console.log(`✓ ${pkg} — already trusted, skipping`);
    continue;
  }
  console.log(`→ ${pkg} (${ORG}/${repo})`);
  const result = spawnSync("npm", args, { stdio: "inherit", windowsHide: true, shell });
  if (result.status !== 0) {
    console.error(`✗ ${pkg} failed (exit ${result.status})`);
    failures++;
  }
}

if (!dryRun) {
  console.log(
    failures === 0
      ? "\nAll packages trusted. Next: switch each repo's release.yml to OIDC and delete the org NPM_TOKEN."
      : `\n${failures} package(s) failed — rerun after fixing.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}
