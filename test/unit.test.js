import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareSemver,
  npmInstallPiArgs,
  officialInstallerCommand,
  loadBundledCatalog,
  validateCatalog,
  parseInstallSpec,
  resolveInstallTarget,
  resolvePifyName,
  assertSafeArg,
  interpolate,
  packageJsonTemplate,
  PifyError,
  ExitCode,
  VERSION,
} from "../dist/index.js";

test("VERSION matches package.json", async () => {
  const { default: pkg } = await import("../package.json", { with: { type: "json" } });
  assert.equal(VERSION, pkg.version);
});

test("npmInstallPiArgs mirrors pi's official installer invocation", () => {
  // npm >= 11 gets --min-release-age=0 (safe: pi ships npm-shrinkwrap.json)
  assert.deepEqual(npmInstallPiArgs("@earendil-works/pi-coding-agent", 11), [
    "install", "-g", "--ignore-scripts", "--min-release-age=0",
    "--no-fund", "--no-audit", "@earendil-works/pi-coding-agent",
  ]);
  // older npm rejects the flag, so it must be omitted
  assert.ok(!npmInstallPiArgs("pkg", 10).includes("--min-release-age=0"));
  // POSIX unwritable-prefix fallback inserts --prefix before the spec
  const withPrefix = npmInstallPiArgs("pkg", 11, "/home/u/.local");
  const at = withPrefix.indexOf("--prefix");
  assert.equal(withPrefix[at + 1], "/home/u/.local");
  assert.equal(withPrefix[withPrefix.length - 1], "pkg");
  // every token must survive the spawn-arg allowlist
  for (const arg of npmInstallPiArgs("@earendil-works/pi-coding-agent@0.84.4", 11)) {
    assert.doesNotThrow(() => assertSafeArg(arg), arg);
  }
});

test("officialInstallerCommand matches the documented one-liners", () => {
  const cmd = officialInstallerCommand();
  if (process.platform === "win32") {
    assert.match(cmd, /install\.ps1/);
  } else {
    assert.match(cmd, /install\.sh/);
  }
});

test("compareSemver orders versions", () => {
  assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
  assert.equal(compareSemver("0.84.1", "0.84.4"), -1);
  assert.equal(compareSemver("1.0.0", "0.99.99"), 1);
  assert.equal(compareSemver("22.19.0", "22.9.0"), 1);
  assert.equal(compareSemver("10.0.0", "9.0.0"), 1);
});

test("bundled catalog is well-formed and validates", () => {
  const catalog = loadBundledCatalog();
  assert.ok(validateCatalog(catalog));
  assert.equal(catalog.scope, "@pify");
  const names = catalog.packages.map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
  for (const expected of [
    "btw", "goal", "memory", "plan-mode", "pretty", "subagent",
    "swarm", "task", "usage", "workflow", "yolo",
  ]) {
    assert.ok(names.includes(expected), `catalog contains ${expected}`);
  }
  for (const pkg of catalog.packages) {
    assert.equal(pkg.npm, `@pify/${pkg.name}`);
    assert.match(pkg.repo, /^https:\/\/github\.com\/pifydev\//);
  }
});

test("validateCatalog rejects out-of-scope npm names", () => {
  const good = loadBundledCatalog();
  assert.ok(validateCatalog(good));
  const evil = structuredClone(good);
  evil.packages[0].npm = "@evil/goal";
  assert.equal(validateCatalog(evil), false);
  const badName = structuredClone(good);
  badName.packages[0].name = "Goal!";
  assert.equal(validateCatalog(badName), false);
  const badVersion = structuredClone(good);
  badVersion.version = "1";
  assert.equal(validateCatalog(badVersion), false);
});

test("parseInstallSpec splits base and pin", () => {
  assert.deepEqual(parseInstallSpec("goal"), { base: "goal", pin: null });
  assert.deepEqual(parseInstallSpec("goal@0.3.0"), { base: "goal", pin: "0.3.0" });
  assert.deepEqual(parseInstallSpec("@pify/goal"), { base: "@pify/goal", pin: null });
  assert.deepEqual(parseInstallSpec("@pify/goal@next"), { base: "@pify/goal", pin: "next" });
  assert.deepEqual(parseInstallSpec("npm:@pify/goal@1.2.3-rc.1"), {
    base: "@pify/goal",
    pin: "1.2.3-rc.1",
  });
});

test("parseInstallSpec refuses range pins", () => {
  for (const bad of ["goal@^1.0.0", "goal@~1.2", "goal@>=1", "goal@1.x", "goal@*", "goal@"]) {
    assert.throws(
      () => parseInstallSpec(bad),
      (err) => err instanceof PifyError && err.code === ExitCode.USAGE,
      bad,
    );
  }
});

test("resolveInstallTarget: catalog names, escape hatch, refusals", () => {
  const catalog = loadBundledCatalog();

  // Short names of planned packages are refused with NOT_FOUND. The live
  // catalog may have none left, so test against a synthetic planned entry.
  const withPlanned = {
    ...catalog,
    packages: [
      ...catalog.packages,
      {
        name: "future-pkg",
        npm: "@pify/future-pkg",
        repo: "https://github.com/pifydev/future-pkg",
        description: "not yet published",
        status: "planned",
      },
    ],
  };
  assert.throws(
    () => resolveInstallTarget(withPlanned, "future-pkg"),
    (err) => err instanceof PifyError && err.code === ExitCode.NOT_FOUND,
  );
  // Published short names resolve.
  assert.equal(resolveInstallTarget(catalog, "goal").npm, "@pify/goal");
  // Unknown short names too.
  assert.throws(
    () => resolveInstallTarget(catalog, "does-not-exist"),
    (err) => err instanceof PifyError && err.code === ExitCode.NOT_FOUND,
  );
  // Explicit @pify form always proceeds (escape hatch).
  const explicit = resolveInstallTarget(catalog, "@pify/goal@0.1.0");
  assert.equal(explicit.explicit, true);
  assert.equal(explicit.npm, "@pify/goal");
  assert.equal(explicit.pin, "0.1.0");
  // Non-@pify sources are usage errors.
  for (const bad of ["@evil/pkg", "git:github.com/x/y", "./local/path", "left-pad"]) {
    let threw = null;
    try {
      resolveInstallTarget(catalog, bad);
    } catch (err) {
      threw = err;
    }
    assert.ok(threw instanceof PifyError, bad);
    assert.ok(
      threw.code === ExitCode.USAGE || threw.code === ExitCode.NOT_FOUND,
      `${bad} -> ${threw.code}`,
    );
  }
});

test("resolvePifyName accepts short, scoped, prefixed; no catalog needed", () => {
  assert.equal(resolvePifyName("goal"), "goal");
  assert.equal(resolvePifyName("@pify/goal"), "goal");
  assert.equal(resolvePifyName("npm:@pify/goal@1.0.0"), "goal");
  assert.equal(resolvePifyName("pify-goal"), "goal");
  assert.equal(resolvePifyName("dropped-from-catalog"), "dropped-from-catalog");
  assert.throws(() => resolvePifyName("@other/pkg"), PifyError);
});

test("assertSafeArg blocks shell metacharacters including ^ and ~", () => {
  for (const ok of [
    "@pify/goal", "npm:@pify/goal", "install", "-g", "--version",
    "@earendil-works/pi-coding-agent", "C:\\nvm4w\\nodejs\\npm", "1.2.3",
  ]) {
    assert.doesNotThrow(() => assertSafeArg(ok), ok);
  }
  for (const bad of [
    "a;b", "a&b", "a|b", "a>b", "a<b", "a`b`", "a$(b)", "a%PATH%a",
    'a"b', "a'b", "a b", "a\nb", "", "a!b", "a*b", "a?b", "a(b)",
    "a^b", "a~b",
  ]) {
    assert.throws(() => assertSafeArg(bad), PifyError, JSON.stringify(bad));
  }
});

test("init templates interpolate and encode the ecosystem rules", () => {
  const vars = {
    name: "@pify/example",
    description: "Example package",
    shortName: "example",
    snakeName: "example",
    piVersion: "0.84.4",
    dir: "example",
  };
  const pkg = JSON.parse(interpolate(packageJsonTemplate(true), vars));
  assert.equal(pkg.name, "@pify/example");
  assert.equal(pkg.type, "module");
  assert.ok(pkg.keywords.includes("pi-package"));
  assert.deepEqual(pkg.pi.extensions, ["./index.ts"]);
  assert.ok(pkg.files.includes("index.ts"), "raw .ts must be in files");
  assert.deepEqual(pkg.publishConfig, { access: "public" });
  // Host packages are optional peers, never dependencies.
  assert.equal(pkg.dependencies, undefined);
  for (const peer of Object.keys(pkg.peerDependencies)) {
    assert.equal(pkg.peerDependencies[peer], "*");
    assert.deepEqual(pkg.peerDependenciesMeta[peer], { optional: true });
  }
  // Unscoped names get no publishConfig.
  const unscoped = JSON.parse(
    interpolate(packageJsonTemplate(false), { ...vars, name: "example" }),
  );
  assert.equal(unscoped.publishConfig, undefined);
});
