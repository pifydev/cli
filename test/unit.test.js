import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareSemver,
  loadBundledCatalog,
  resolvePackage,
  assertSafeArg,
  PifyError,
  ExitCode,
} from "../dist/index.js";

test("compareSemver orders versions", () => {
  assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
  assert.equal(compareSemver("0.84.1", "0.84.4"), -1);
  assert.equal(compareSemver("1.0.0", "0.99.99"), 1);
  assert.equal(compareSemver("22.19.0", "22.9.0"), 1);
  assert.equal(compareSemver("10.0.0", "9.0.0"), 1);
});

test("bundled catalog is well-formed", () => {
  const catalog = loadBundledCatalog();
  assert.equal(catalog.scope, "@pify");
  assert.ok(catalog.packages.length >= 11);
  for (const pkg of catalog.packages) {
    assert.match(pkg.npm, /^@pify\/[a-z-]+$/, `npm name for ${pkg.name}`);
    assert.equal(pkg.npm, `@pify/${pkg.name}`);
    assert.match(pkg.repo, /^https:\/\/github\.com\/pifydev\//);
    assert.ok(["published", "planned"].includes(pkg.status));
    assert.ok(pkg.description.length > 0);
  }
  // Exactly the packages the org has planned, no dupes.
  const names = catalog.packages.map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
  for (const expected of [
    "btw", "goal", "memory", "plan-mode", "pretty", "subagent",
    "swarm", "task", "usage", "workflow", "yolo",
  ]) {
    assert.ok(names.includes(expected), `catalog contains ${expected}`);
  }
});

test("resolvePackage accepts short, scoped, and prefixed names", () => {
  const catalog = loadBundledCatalog();
  assert.equal(resolvePackage(catalog, "goal").npm, "@pify/goal");
  assert.equal(resolvePackage(catalog, "@pify/goal").name, "goal");
  assert.equal(resolvePackage(catalog, "pify-goal").name, "goal");
  assert.equal(resolvePackage(catalog, "GOAL").name, "goal");
});

test("resolvePackage rejects unknown names with NOT_FOUND", () => {
  const catalog = loadBundledCatalog();
  assert.throws(
    () => resolvePackage(catalog, "does-not-exist"),
    (err) => err instanceof PifyError && err.code === ExitCode.NOT_FOUND,
  );
});

test("assertSafeArg blocks shell metacharacters", () => {
  // Everything we legitimately pass must be allowed...
  for (const ok of [
    "@pify/goal", "npm:@pify/goal", "install", "-g", "--version",
    "@earendil-works/pi-coding-agent", "C:\\nvm4w\\nodejs\\npm", "1.2.3",
  ]) {
    assert.doesNotThrow(() => assertSafeArg(ok), ok);
  }
  // ...and shell injection vectors must not.
  for (const bad of [
    "a;b", "a&b", "a|b", "a>b", "a<b", "a`b`", "a$(b)", "a%PATH%a",
    'a"b', "a'b", "a b", "a\nb", "", "a!b", "a*b", "a?b", "a(b)",
  ]) {
    assert.throws(() => assertSafeArg(bad), PifyError, JSON.stringify(bad));
  }
});
