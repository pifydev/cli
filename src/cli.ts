import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { setup } from "./commands/setup.js";
import { install, remove } from "./commands/install.js";
import { list } from "./commands/list.js";
import { update } from "./commands/update.js";
import { doctor } from "./commands/doctor.js";
import { PifyError, ExitCode, usageError } from "./errors.js";
import { error, info, out, setColor, style } from "./ui.js";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json") as { version: string };

const HELP = `${style.bold("pify")} — front door for the Pify suite ${style.dim(`v${VERSION}`)}

${style.bold("Usage:")}
  pify <command> [options]

${style.bold("Commands:")}
  setup                 Install the pi coding agent (no-op if already installed)
  install <package...>  Install @pify packages           ${style.dim("pify install goal memory")}
  remove <package...>   Remove @pify packages            ${style.dim("pify remove goal")}
  update [target...]    Update pi and installed packages ${style.dim("pify update · pify update pi")}
  list                  Show the @pify package catalog with install state
  doctor                Diagnose the local pi/pify environment

${style.bold("Options:")}
  -l, --local           Install/remove in project scope (.pi/settings.json)
      --catalog         With update: refresh the package catalog only
      --force           With setup: reinstall pi even if present
      --no-color        Disable colored output (NO_COLOR is also respected)
  -h, --help            Show this help
  -v, --version         Show version

${style.bold("Examples:")}
  npx @pify/cli setup            ${style.dim("# bootstrap pi without installing pify")}
  pify install goal plan-mode    ${style.dim("# short names resolve to @pify/*")}
  pify update                    ${style.dim("# update pi + all installed @pify packages")}

Packages live at ${style.cyan("https://github.com/pifydev")}. Anything beyond the
commands above is pi's job — run ${style.bold("pi --help")}.
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      local: { type: "boolean", short: "l", default: false },
      catalog: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "no-color": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (values["no-color"]) setColor(false);

  if (values.version) {
    out(VERSION);
    return 0;
  }

  const [command, ...rest] = positionals.map(String);

  if (values.help || !command) {
    out(HELP);
    return values.help ? 0 : ExitCode.USAGE;
  }

  switch (command) {
    case "setup":
      return setup({ force: Boolean(values.force) });
    case "install":
    case "i":
    case "add":
      return install(rest, { local: Boolean(values.local) });
    case "remove":
    case "rm":
    case "uninstall":
      return remove(rest, { local: Boolean(values.local) });
    case "update":
    case "up":
      return update(rest, { catalogOnly: Boolean(values.catalog) });
    case "list":
    case "ls":
      return list();
    case "doctor":
      return doctor();
    default:
      throw usageError(
        `Unknown command: ${JSON.stringify(command)}`,
        "Run `pify --help` to see available commands.",
      );
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (err instanceof PifyError) {
      error(err.message);
      if (err.hint) info(`  ${style.dim(err.hint)}`);
      process.exitCode = err.code;
    } else {
      error(err instanceof Error ? (err.stack ?? err.message) : String(err));
      process.exitCode = ExitCode.FAILURE;
    }
  });
