#!/usr/bin/env node
/**
 * Validate every suite skill against the Agent Skills specification
 * (https://agentskills.io/specification).
 *
 * Each @pify package ships `skills/<name>/SKILL.md`, and nothing checked them
 * until now: they happened to conform, which is not the same as staying that
 * way. The rules below are the spec's, restated — a closed field set, a name
 * that matches its directory, and the two length limits — so this runs with
 * no network and no Python toolchain. For the authoritative check, the spec
 * ships a reference validator: `skills-ref validate ./skill-dir`.
 *
 * Usage:
 *   node scripts/check-skills.mjs [--root <dir>]   # default: the cli's parent
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_FIELDS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_COMPATIBILITY = 500;
/** The spec's guidance, not a hard rule: past this, split into references/. */
const BODY_LINE_GUIDANCE = 500;

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const root = rootIndex >= 0 ? resolve(args[rootIndex + 1] ?? defaultRoot) : defaultRoot;

/** Every skills/<name>/SKILL.md under a sibling package directory. */
function findSkills(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const skillsDir = join(dir, entry, "skills");
    if (!existsSync(skillsDir) || !statSync(skillsDir).isDirectory()) continue;
    for (const name of readdirSync(skillsDir)) {
      const file = join(skillsDir, name, "SKILL.md");
      if (existsSync(file)) found.push(file);
    }
  }
  return found.sort();
}

/**
 * Frontmatter as flat key/value pairs. Nested mappings (metadata) are read as
 * present-but-unparsed, which is all the field checks need.
 */
function readFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split("\n")) {
    if (/^\s/.test(line)) continue; // nested value
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

const problems = [];
const skills = findSkills(root);

for (const file of skills) {
  const dirName = basename(dirname(file));
  const text = readFileSync(file, "utf8");
  const fail = (why) => problems.push(`${file}: ${why}`);

  const fields = readFrontmatter(text);
  if (!fields) {
    fail("no YAML frontmatter");
    continue;
  }

  for (const key of Object.keys(fields)) {
    if (!ALLOWED_FIELDS.has(key)) fail(`"${key}" is not a field the spec defines`);
  }

  const name = fields.name ?? "";
  if (!name) fail("name is required");
  else {
    if (name.length > MAX_NAME) fail(`name is ${name.length} characters (max ${MAX_NAME})`);
    if (!NAME_RE.test(name)) {
      fail(`name "${name}" must be lowercase alphanumeric with single hyphens, no leading/trailing hyphen`);
    }
    if (name !== dirName) fail(`name "${name}" does not match its directory "${dirName}"`);
  }

  const description = fields.description ?? "";
  if (!description) fail("description is required");
  else if (description.length > MAX_DESCRIPTION) {
    fail(`description is ${description.length} characters (max ${MAX_DESCRIPTION})`);
  }

  if (fields.compatibility !== undefined && fields.compatibility.length > MAX_COMPATIBILITY) {
    fail(`compatibility is ${fields.compatibility.length} characters (max ${MAX_COMPATIBILITY})`);
  }

  const lines = text.split("\n").length;
  if (lines > BODY_LINE_GUIDANCE) {
    fail(`${lines} lines — the spec suggests keeping SKILL.md under ${BODY_LINE_GUIDANCE} and moving detail to references/`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`FAIL ${problem}`);
  console.error(`\n${problems.length} problem(s) across ${skills.length} skill(s).`);
  process.exitCode = 1;
} else {
  console.log(`${skills.length} skill(s) conform to the Agent Skills spec.`);
}
