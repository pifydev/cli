import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  dts: { entry: { index: "src/index.ts" } },
  sourcemap: false,
  splitting: false,
  // Zero runtime dependencies: everything resolves to node: builtins.
  banner: { js: "#!/usr/bin/env node" },
});
