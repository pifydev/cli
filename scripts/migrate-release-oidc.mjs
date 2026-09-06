#!/usr/bin/env node
/**
 * Switch every extension repo's release.yml from the org NPM_TOKEN secret to
 * npm OIDC trusted publishing, the way pifydev/cli already publishes.
 *
 * ORDER MATTERS. A repo that publishes via OIDC before npm knows about the
 * trusted publisher cannot publish at all, so:
 *
 *   1. npm login                              (browser 2FA — cannot be scripted)
 *   2. node scripts/setup-npm-trust.mjs       (registers every package)
 *   3. node scripts/migrate-release-oidc.mjs  (this script)
 *   4. release one package, confirm it publishes
 *   5. gh secret delete NPM_TOKEN --org pifydev
 *
 * Step 5 is deliberately not automated: deleting the secret while any repo
 * still publishes with it breaks that repo's releases silently, at the worst
 * possible moment — the next release.
 *
 * Usage:
 *   node scripts/migrate-release-oidc.mjs [--dry-run] [--root <dir>]
 *
 * --root defaults to the parent of the cli checkout (the layout where every
 * pifydev repo is a sibling directory).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOS = [
  "ask-question",
  "btw",
  "goal",
  "memory",
  "plan-mode",
  "pretty",
  "subagent",
  "swarm",
  "task",
  "todo",
  "usage",
  "workflow",
  "worktree",
  "yolo",
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const rootIndex = args.indexOf("--root");
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const root = rootIndex >= 0 ? resolve(args[rootIndex + 1] ?? defaultRoot) : defaultRoot;

/** The publish step as it exists today (token) and as it should end up (OIDC). */
const TOKEN_STEP = `      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}`;

const OIDC_STEP = `      - run: npm install -g npm@latest # trusted publishing needs npm >= 11.5.1
      - run: npm publish # OIDC; no NPM_TOKEN, no --provenance flag`;

const TOKEN_COMMENT = `# Auth: NPM_TOKEN org secret (pifydev org, visibility all). First publish
# creates the package; afterwards a Trusted Publisher can be configured on
# npmjs.com and this workflow switched to OIDC like pifydev/cli.`;

const OIDC_COMMENT = `# Auth: npm OIDC trusted publishing (org pifydev, this repo, release.yml).
# No NPM_TOKEN: npm authenticates via the id-token permission and attaches
# provenance automatically.`;

let changed = 0;
let already = 0;
let missing = 0;

for (const repo of REPOS) {
  const file = join(root, repo, ".github", "workflows", "release.yml");
  if (!existsSync(file)) {
    console.error(`? ${repo} — no release.yml at ${file}`);
    missing++;
    continue;
  }
  const before = readFileSync(file, "utf8");
  if (!before.includes("NODE_AUTH_TOKEN")) {
    console.log(`✓ ${repo} — already on OIDC`);
    already++;
    continue;
  }
  if (!before.includes(TOKEN_STEP)) {
    console.error(`✗ ${repo} — publish step does not match the expected token form; edit by hand`);
    missing++;
    continue;
  }

  const after = before.replace(TOKEN_STEP, OIDC_STEP).replace(TOKEN_COMMENT, OIDC_COMMENT);
  if (dryRun) {
    console.log(`→ ${repo} — would switch to OIDC`);
  } else {
    writeFileSync(file, after);
    console.log(`→ ${repo} — switched to OIDC (commit and push this repo)`);
  }
  changed++;
}

console.log(
  `\n${changed} to change, ${already} already OIDC, ${missing} needing attention.` +
    (dryRun ? " (dry run — nothing written)" : ""),
);
if (!dryRun && changed > 0) {
  console.log("Next: commit each repo, release one package to confirm, THEN delete the org secret:");
  console.log("  gh secret delete NPM_TOKEN --org pifydev");
}
process.exitCode = missing > 0 ? 1 : 0;
