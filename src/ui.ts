/**
 * Terminal output. Colors follow the informal cross-tool contract:
 * NO_COLOR disables, FORCE_COLOR overrides, otherwise require a TTY.
 */

function detectColor(): boolean {
  const { NO_COLOR, FORCE_COLOR, TERM } = process.env;
  if (FORCE_COLOR !== undefined && FORCE_COLOR !== "0") return true;
  if (NO_COLOR !== undefined && NO_COLOR !== "") return false;
  if (TERM === "dumb") return false;
  return Boolean(process.stdout.isTTY);
}

let colorEnabled = detectColor();

/** Used by the --no-color flag, which must win over auto-detection. */
export function setColor(enabled: boolean): void {
  colorEnabled = enabled;
}

const wrap =
  (open: string, close: string) =>
  (s: string): string =>
    colorEnabled ? `[${open}m${s}[${close}m` : s;

export const style = {
  bold: wrap("1", "22"),
  dim: wrap("2", "22"),
  red: wrap("31", "39"),
  green: wrap("32", "39"),
  yellow: wrap("33", "39"),
  blue: wrap("34", "39"),
  magenta: wrap("35", "39"),
  cyan: wrap("36", "39"),
};

/** Diagnostics go to stderr so `pify list` etc. stay pipeable. */
export function info(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

export function step(msg: string): void {
  process.stderr.write(`${style.cyan("›")} ${msg}\n`);
}

export function success(msg: string): void {
  process.stderr.write(`${style.green("✓")} ${msg}\n`);
}

export function warn(msg: string): void {
  process.stderr.write(`${style.yellow("!")} ${msg}\n`);
}

export function error(msg: string): void {
  process.stderr.write(`${style.red("✗")} ${msg}\n`);
}

/** Data output goes to stdout. */
export function out(msg = ""): void {
  process.stdout.write(`${msg}\n`);
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI;
}

/** Left-pad a two-column table to a consistent gutter. */
export function table(rows: Array<[string, string]>, indent = "  "): string {
  const width = rows.reduce((max, [left]) => Math.max(max, left.length), 0);
  return rows
    .map(([left, right]) =>
      right
        ? `${indent}${left.padEnd(width)}  ${style.dim(right)}`
        : `${indent}${left}`,
    )
    .join("\n");
}
