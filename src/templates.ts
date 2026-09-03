/**
 * The five `pify init` file templates, embedded as string literals so the
 * tarball ships nothing extra. Every line of the package.json template
 * encodes a verified ecosystem rule — see the comments in initCommand.
 */

export interface TemplateVars {
  name: string;
  description: string;
  shortName: string;
  snakeName: string;
  piVersion: string;
  dir: string;
}

export function interpolate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key as keyof TemplateVars];
    if (value === undefined) throw new Error(`Unknown template variable: ${key}`);
    return value;
  });
}

export function packageJsonTemplate(scoped: boolean): string {
  const publishConfig = scoped ? `\n  "publishConfig": { "access": "public" },` : "";
  return `{
  "name": "{{name}}",
  "version": "0.1.0",
  "description": "{{description}}",
  "type": "module",
  "keywords": ["pi-package", "pi-extension", "pi", "pify"],
  "license": "MIT",${publishConfig}
  "files": ["index.ts", "src"],
  "pi": {
    "extensions": ["./index.ts"]
  },
  "engines": { "node": ">=22.19.0" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  },
  "peerDependenciesMeta": {
    "@earendil-works/pi-ai": { "optional": true },
    "@earendil-works/pi-agent-core": { "optional": true },
    "@earendil-works/pi-coding-agent": { "optional": true },
    "@earendil-works/pi-tui": { "optional": true },
    "typebox": { "optional": true }
  },
  "devDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*",
    "typescript": "^5.7.2",
    "@types/node": "^22.10.2"
  }
}
`;
}

export const INDEX_TS = `import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Rules this template already follows:
// - Signal tool errors by THROWING from execute(); returned values never set isError.
// - Truncate large output with truncateHead/truncateTail from
//   @earendil-works/pi-coding-agent (built-in limits: 50 KB / 2000 lines).
// - Use StringEnum from @earendil-works/pi-ai for enum parameters;
//   Type.Union/Type.Literal breaks on Google's API.
// - Use the CONFIG_DIR_NAME export instead of hardcoding ".pi" for
//   project-local config paths.
const exampleTool = defineTool({
  name: "{{snakeName}}_hello",
  label: "{{shortName}} hello",
  description: "Example tool for {{name}}. Replace with your own.",
  parameters: Type.Object({
    name: Type.String({ description: "Name to greet" }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    return {
      content: [{ type: "text", text: \`Hello, \${params.name}!\` }],
      details: { greeted: params.name },
    };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(exampleTool);

  pi.registerCommand("{{shortName}}-hello", {
    description: "Example command for {{name}}. Replace with your own.",
    handler: async (args, _ctx) => {
      // \`args\` is the single raw string typed after the command name.
      // There is no argv parsing - split it yourself if you need arguments.
    },
  });

  // Never start watchers, sockets, timers, or child processes here in the
  // factory: it can run in invocations that never start a session.
  pi.on("session_start", async (_event, _ctx) => {
    // Start background resources here.
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    // Tear them down here. This must be idempotent: it fires on quit,
    // /reload, /new, /resume, and /fork.
  });
}
`;

export const TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "types": ["node"]
  },
  "include": ["index.ts", "src/**/*.ts"]
}
`;

export const GITIGNORE = `node_modules/
`;

export const README_MD = `# {{name}}

{{description}}

A Pi Package for the pi coding agent (https://pi.dev).

## Develop

    npm install              # dev dependencies for typechecking
    pi install ./{{dir}}     # register locally; hot-reloads with /reload
    pi -e ./index.ts         # or load ad hoc for a single run
    npm run typecheck

## Publish

    npm publish --access public

Then install anywhere with: pi install npm:{{name}}

Tested with pi {{piVersion}}.
`;
