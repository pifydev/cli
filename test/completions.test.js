import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateCompletion,
  COMMAND_SPECS,
  COMPLETION_SHELLS,
  parseArgsOptionsFor,
  loadBundledCatalog,
  PifyError,
} from "../dist/index.js";

test("every shell script embeds all commands, aliases, flags, and packages", () => {
  const packages = loadBundledCatalog().packages.map((p) => p.name);
  for (const shell of COMPLETION_SHELLS) {
    const script = generateCompletion(shell);
    for (const spec of COMMAND_SPECS) {
      assert.ok(script.includes(spec.name), `${shell}: command ${spec.name}`);
      for (const alias of spec.aliases) {
        assert.ok(script.includes(alias), `${shell}: alias ${alias}`);
      }
      for (const flag of spec.flags) {
        assert.ok(
          script.includes(`--${flag.name}`) || script.includes(`-l ${flag.name}`),
          `${shell}: flag --${flag.name} of ${spec.name}`,
        );
      }
    }
    for (const pkg of packages) {
      assert.ok(script.includes(pkg), `${shell}: package ${pkg}`);
    }
    assert.ok(script.includes("pify"), `${shell}: binary name`);
  }
});

test("unknown shell is a usage error", () => {
  assert.throws(
    () => generateCompletion("tcsh"),
    (err) => err instanceof PifyError && err.code === 2,
  );
});

test("registry drives parseArgs tables (value flags become string type)", () => {
  const setup = COMMAND_SPECS.find((c) => c.name === "setup");
  const options = parseArgsOptionsFor(setup);
  assert.equal(options["pi-version"].type, "string");
  assert.equal(options.force.type, "boolean");
  assert.equal(options.force.default, false);

  const install = COMMAND_SPECS.find((c) => c.name === "install");
  assert.equal(parseArgsOptionsFor(install).local.short, "l");
});

test("registry has no duplicate names or aliases", () => {
  const seen = new Set();
  for (const spec of COMMAND_SPECS) {
    for (const name of [spec.name, ...spec.aliases]) {
      assert.ok(!seen.has(name), `duplicate: ${name}`);
      seen.add(name);
    }
  }
});

test("bash and zsh scripts are eval-shaped (function + registration)", () => {
  const bash = generateCompletion("bash");
  assert.ok(bash.includes("complete -F _pify_completions pify"));
  const zsh = generateCompletion("zsh");
  assert.ok(zsh.startsWith("#compdef pify"));
  const fish = generateCompletion("fish");
  assert.ok(fish.includes("complete -c pify -f"));
  const ps = generateCompletion("powershell");
  assert.ok(ps.includes("Register-ArgumentCompleter -Native -CommandName pify"));
});
