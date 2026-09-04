/**
 * Declarative command surface — the single source of truth consumed by BOTH
 * the argument parser (cli.ts) and the completion generator (completions.ts),
 * so completions can never drift from the real CLI (oh-my-pi's principle).
 */

export interface FlagSpec {
  name: string;
  short?: string;
  /** Flag takes a value (e.g. --pi-version <version>). */
  takesValue?: boolean;
  description: string;
}

export type PositionalKind = "none" | "packages" | "updateTargets" | "directory" | "shell";

export interface CommandSpec {
  name: string;
  aliases: string[];
  description: string;
  positional: PositionalKind;
  flags: FlagSpec[];
}

export const GLOBAL_FLAGS: FlagSpec[] = [
  { name: "help", short: "h", description: "Show help" },
  { name: "version", short: "v", description: "Print the pify version" },
  { name: "no-color", description: "Disable colored output" },
];

export const COMMAND_SPECS: CommandSpec[] = [
  {
    name: "setup",
    aliases: [],
    description: "Install the pi coding agent (safe to re-run)",
    positional: "none",
    flags: [
      { name: "force", description: "Reinstall pi even if present" },
      { name: "pi-version", takesValue: true, description: "Install an exact pi version" },
      { name: "installer", description: "Run pi's official interactive installer" },
    ],
  },
  {
    name: "install",
    aliases: ["i", "add"],
    description: "Install @pify packages by short name",
    positional: "packages",
    flags: [
      { name: "local", short: "l", description: "Project scope" },
      { name: "approve", short: "a", description: "Forward --approve to pi" },
      { name: "dry-run", description: "Print the pi commands without running them" },
    ],
  },
  {
    name: "remove",
    aliases: ["rm", "uninstall"],
    description: "Remove installed @pify packages",
    positional: "packages",
    flags: [
      { name: "local", short: "l", description: "Project scope" },
      { name: "approve", short: "a", description: "Forward --approve to pi" },
      { name: "dry-run", description: "Print the pi commands without running them" },
    ],
  },
  {
    name: "update",
    aliases: ["up"],
    description: "Update pi and installed @pify packages",
    positional: "updateTargets",
    flags: [
      { name: "catalog", description: "Refresh the catalog cache only" },
      { name: "dry-run", description: "Print the update plan without executing" },
    ],
  },
  {
    name: "list",
    aliases: ["ls"],
    description: "Show the @pify catalog with install state",
    positional: "none",
    flags: [{ name: "json", description: "Machine-readable output" }],
  },
  {
    name: "doctor",
    aliases: [],
    description: "Diagnose the local pi/pify environment",
    positional: "none",
    flags: [{ name: "json", description: "Machine-readable output" }],
  },
  {
    name: "init",
    aliases: [],
    description: "Scaffold a new Pi Package",
    positional: "directory",
    flags: [
      { name: "name", takesValue: true, description: "npm package name" },
      { name: "description", takesValue: true, description: "Package description" },
    ],
  },
  {
    name: "completions",
    aliases: [],
    description: "Print a shell completion script",
    positional: "shell",
    flags: [],
  },
];

export const COMPLETION_SHELLS = ["bash", "zsh", "fish", "powershell"] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

/** Build the strict parseArgs options table for one command. */
export function parseArgsOptionsFor(
  spec: CommandSpec,
): Record<string, { type: "boolean" | "string"; short?: string; default?: boolean }> {
  const options: Record<string, { type: "boolean" | "string"; short?: string; default?: boolean }> = {};
  for (const flag of spec.flags) {
    options[flag.name] = flag.takesValue
      ? { type: "string", ...(flag.short ? { short: flag.short } : {}) }
      : { type: "boolean", default: false, ...(flag.short ? { short: flag.short } : {}) };
  }
  return options;
}
