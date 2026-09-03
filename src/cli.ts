import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { setup } from "./commands/setup.js";
import { install } from "./commands/install.js";
import { remove } from "./commands/remove.js";
import { update } from "./commands/update.js";
import { list } from "./commands/list.js";
import { doctor } from "./commands/doctor.js";
import { init } from "./commands/init.js";
import { mainHelp, commandHelp } from "./help.js";
import { PifyError, ExitCode, usageError } from "./errors.js";
import { error, errorHint, out, setColor } from "./ui.js";
import { VERSION } from "./version.js";

interface Command {
  name: string;
  aliases: string[];
  options: ParseArgsOptionsConfig;
  allowPositionals: boolean;
  run(positionals: string[], values: Record<string, unknown>): Promise<number>;
}

const COMMANDS: Command[] = [
  {
    name: "setup",
    aliases: [],
    options: {
      force: { type: "boolean", default: false },
      "pi-version": { type: "string" },
      installer: { type: "boolean", default: false },
    },
    allowPositionals: false,
    run: (_p, v) =>
      setup({
        force: Boolean(v.force),
        piVersion: v["pi-version"] as string | undefined,
        installer: Boolean(v.installer),
      }),
  },
  {
    name: "install",
    aliases: ["i", "add"],
    options: {
      local: { type: "boolean", short: "l", default: false },
      approve: { type: "boolean", short: "a", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: true,
    run: (p, v) =>
      install(p, {
        local: Boolean(v.local),
        approve: Boolean(v.approve),
        dryRun: Boolean(v["dry-run"]),
      }),
  },
  {
    name: "remove",
    aliases: ["rm", "uninstall"],
    options: {
      local: { type: "boolean", short: "l", default: false },
      approve: { type: "boolean", short: "a", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: true,
    run: (p, v) =>
      remove(p, {
        local: Boolean(v.local),
        approve: Boolean(v.approve),
        dryRun: Boolean(v["dry-run"]),
      }),
  },
  {
    name: "update",
    aliases: ["up"],
    options: {
      catalog: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: true,
    run: (p, v) => update(p, { catalogOnly: Boolean(v.catalog), dryRun: Boolean(v["dry-run"]) }),
  },
  {
    name: "list",
    aliases: ["ls"],
    options: { json: { type: "boolean", default: false } },
    allowPositionals: false,
    run: (_p, v) => list({ json: Boolean(v.json) }),
  },
  {
    name: "doctor",
    aliases: [],
    options: { json: { type: "boolean", default: false } },
    allowPositionals: false,
    run: (_p, v) => doctor({ json: Boolean(v.json) }),
  },
  {
    name: "init",
    aliases: [],
    options: {
      name: { type: "string" },
      description: { type: "string" },
    },
    allowPositionals: true,
    run: (p, v) =>
      init(p[0], {
        name: v.name as string | undefined,
        description: v.description as string | undefined,
      }),
  },
];

async function main(argv: string[]): Promise<number> {
  // --no-color must win everywhere, including in help output, so peel it
  // before anything renders.
  const args = argv.filter((a) => a !== "--no-color");
  if (args.length !== argv.length) setColor(false);

  if (args.length === 0) {
    out(mainHelp());
    return ExitCode.USAGE;
  }

  const first = args[0]!;
  if (first === "-h" || first === "--help") {
    out(mainHelp());
    return 0;
  }
  if (first === "-v" || first === "--version") {
    out(VERSION);
    return 0;
  }
  if (first.startsWith("-")) {
    throw usageError(`Unknown option ${first}.`, 'Use "pify --help".');
  }

  const command = COMMANDS.find((c) => c.name === first || c.aliases.includes(first));
  if (!command) {
    throw usageError(
      `Unknown command: ${JSON.stringify(first)}`,
      'Run "pify --help" to see available commands.',
    );
  }

  const rest = args.slice(1);
  if (rest.includes("-h") || rest.includes("--help")) {
    out(commandHelp(command.name));
    return 0;
  }

  // Strict per-command parse: unknown flags are usage errors, not surprises.
  let parsed: { values: Record<string, unknown>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: rest,
      options: command.options,
      allowPositionals: command.allowPositionals,
      strict: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const unknown = /Unknown option '(--?[^']+)'/.exec(message)?.[1];
    throw usageError(
      unknown ? `Unknown option ${unknown} for "${command.name}".` : message,
      `Use "pify --help" or "pify ${command.name} --help".`,
    );
  }

  return command.run(parsed.positionals, parsed.values);
}

main(process.argv.slice(2))
  .then((code) => {
    // Always process.exitCode, never process.exit(0): on Windows, Node can
    // assert when exit(0) follows a fetch(). Let the event loop drain.
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (err instanceof PifyError) {
      error(err.message);
      if (err.hint) errorHint(err.hint);
      process.exitCode = err.code;
    } else {
      error(err instanceof Error ? (err.stack ?? err.message) : String(err));
      process.exitCode = ExitCode.FAILURE;
    }
  });
