import { style } from "./ui.js";

/** Bold the known section headers; dim `#` comment lines. Help is stdout. */
function render(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (/^(Usage|Commands|Short forms|Options|Examples|Environment Variables):$/.test(line)) {
        return style.bold(line);
      }
      if (/^\s+#/.test(line)) return style.dim(line);
      return line;
    })
    .join("\n");
}

export function mainHelp(): string {
  return render(`${style.bold("pify")} - front door for the Pify suite for the pi coding agent

Usage:
  pify <command> [options]

Commands:
  setup                  Install the pi coding agent (safe to re-run)
  install <name...>      Install @pify packages by short name
  remove <name...>       Remove installed @pify packages
  update [pi|<name...>]  Update pi and installed @pify packages
  list                   Show the @pify catalog with install state
  doctor                 Diagnose the local pi/pify environment
  init [dir]             Scaffold a new Pi Package
  completions <shell>    Print a completion script (bash|zsh|fish|powershell)

Short forms:
  i = install, rm = remove, up = update, ls = list

Options:
  -h, --help             Show help (pify <command> --help for details)
  -v, --version          Print the pify version
      --no-color         Disable colored output

Examples:
  # Bootstrap a bare machine (installs pi via npm)
  npx @pify/cli setup

  # Install packages by short name
  pify install goal task

  # Keep pi and every installed @pify package current
  pify update

  # Scaffold a new extension package
  pify init my-extension

Environment Variables:
  PI_CODING_AGENT_DIR    Override pi's agent directory (default: ~/.pi/agent)
  PIFY_CATALOG_URL       Override the remote catalog URL
  PIFY_OFFLINE, PI_OFFLINE
                         Set to 1/true/yes to skip catalog and version lookups
  NO_COLOR               Disable colored output

Package operations are delegated to the pi CLI; pify never edits pi's
settings. Anything beyond these commands is pi's job: run pi --help.
`);
}

const COMMAND_HELP: Record<string, string> = {
  setup: `Usage:
  pify setup [--force] [--pi-version <version>] [--installer]

Install the pi coding agent. Safe to re-run; reports status when pi is
already installed. Uses the same npm invocation as pi's official installers
(--ignore-scripts --min-release-age=0), falls back to bun when npm is
absent, and to --prefix ~/.local on POSIX when npm's global prefix is not
writable (never sudo). Updates of an existing pi are pi's own job: run
pify update pi.

Options:
      --force                Reinstall pi even if it is already installed
      --pi-version <version> Install an exact pi version (may downgrade)
      --installer            Run pi's official interactive installer for
                             this OS (can bootstrap Node and Git Bash;
                             needs a terminal, refuses in CI)

Examples:
  # Bootstrap a bare machine
  npx @pify/cli setup

  # Pin the version your team has tested
  pify setup --pi-version 0.84.4

  # Full native experience (Windows: install.ps1, Unix: install.sh)
  pify setup --installer
`,
  install: `Usage:
  pify install <name...> [-l] [-a] [--dry-run]

Install @pify packages by short name. Names resolve against the Pify catalog
(goal -> npm:@pify/goal); the install itself is delegated to pi install.
Exact version pins are accepted (goal@0.3.0); range specifiers are refused.

Options:
  -l, --local            Project scope (.pi/settings.json, .pi/npm)
  -a, --approve          Forward --approve to pi (scripted -l installs)
      --dry-run          Print the pi commands without running them

Examples:
  # Install two packages by short name
  pify install goal task

  # Project-scoped install in CI (pre-approves project trust)
  pify install goal -l -a
`,
  remove: `Usage:
  pify remove <name...> [-l] [-a] [--dry-run]

Remove installed @pify packages by short name. Delegates to pi remove.

Options:
  -l, --local            Project scope
  -a, --approve          Forward --approve to pi
      --dry-run          Print the pi commands without running them

Examples:
  pify remove goal
`,
  update: `Usage:
  pify update [pi | <name...>] [--catalog] [--dry-run]

With no target: update pi itself, then every installed @pify package, then
refresh the catalog cache. "pify update pi" updates only the agent; named
targets update only those packages. Exact version pins are never advanced;
re-pin with pify install <name>@<version>.

Options:
      --catalog          Refresh the remote catalog cache only
      --dry-run          Print the update plan without executing it

Examples:
  # Everything current in one pass
  pify update

  # Agent only
  pify update pi
`,
  list: `Usage:
  pify list [--json]

Show the @pify catalog with local install state. pi list shows what is
installed; pify list also shows what exists and what is coming.

Options:
      --json             Machine-readable output

Examples:
  pify list
`,
  doctor: `Usage:
  pify doctor [--json]

Diagnose the local pi/pify environment: Node and npm, the pi install,
settings files, and installed @pify packages. Exit 0 means healthy; 1 means
problems were found.

Options:
      --json             Machine-readable output

Examples:
  pify doctor
`,
  completions: `Usage:
  pify completions <bash|zsh|fish|powershell>

Print a shell completion script generated from the live command registry —
command names, aliases, flags, and package names all tab-complete.

Examples:
  # bash / zsh — evaluate at shell startup (add to your rc file)
  eval "$(pify completions bash)"
  eval "$(pify completions zsh)"

  # fish
  pify completions fish > ~/.config/fish/completions/pify.fish

  # PowerShell — add to $PROFILE
  pify completions powershell | Out-String | Invoke-Expression
`,
  init: `Usage:
  pify init [dir] [--name <package-name>] [--description <text>]

Scaffold a new Pi Package: a raw-TypeScript extension entry (no build step),
correct peerDependencies layout, pi manifest, and files allowlist. The
target directory must be empty or not exist.

Options:
      --name <name>          npm package name (default: the directory name)
      --description <text>   Package description

Examples:
  # New extension package in ./my-extension
  pify init my-extension

  # Scoped name
  pify init tools --name @myorg/pi-tools
`,
};

export function commandHelp(command: string): string {
  const text = COMMAND_HELP[command];
  return text ? render(text) : mainHelp();
}
