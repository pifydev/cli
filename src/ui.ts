/**
 * Terminal output. Color follows chalk-5 semantics, computed per stream:
 * FORCE_COLOR (non-0) wins, then NO_COLOR / TERM=dumb disable, then TTY.
 * Results and progress go to stdout; warnings and errors go to stderr.
 */

function detectColor(stream: NodeJS.WriteStream): boolean {
  const { NO_COLOR, FORCE_COLOR, TERM } = process.env;
  if (FORCE_COLOR !== undefined && FORCE_COLOR !== "0") return true;
  if (NO_COLOR !== undefined && NO_COLOR !== "") return false;
  if (TERM === "dumb") return false;
  return Boolean(stream.isTTY);
}

let stdoutColor = detectColor(process.stdout);
let stderrColor = detectColor(process.stderr);

/** Used by the --no-color flag, which must win over auto-detection. */
export function setColor(enabled: boolean): void {
  stdoutColor = enabled;
  stderrColor = enabled;
}

type Paint = (s: string) => string;

function palette(enabled: () => boolean): Record<
  "bold" | "dim" | "red" | "green" | "yellow" | "cyan",
  Paint
> {
  const wrap =
    (open: string, close: string): Paint =>
    (s) =>
      enabled() ? `[${open}m${s}[${close}m` : s;
  return {
    bold: wrap("1", "22"),
    dim: wrap("2", "22"),
    red: wrap("31", "39"),
    green: wrap("32", "39"),
    yellow: wrap("33", "39"),
    cyan: wrap("36", "39"),
  };
}

/** Styles gated on stdout (results, progress, help). */
export const style = palette(() => stdoutColor);
/** Styles gated on stderr (warnings, errors). */
export const estyle = palette(() => stderrColor);

/** Result / status line to stdout. */
export function out(msg = ""): void {
  process.stdout.write(`${msg}\n`);
}

/** Dim `$ <command>` line preceding a delegated child process. */
export function step(command: string): void {
  process.stdout.write(`${style.dim(`$ ${command}`)}\n`);
}

export function success(msg: string): void {
  process.stdout.write(`${style.green(msg)}\n`);
}

export function hint(msg: string): void {
  process.stdout.write(`${style.dim(msg)}\n`);
}

export function warn(msg: string): void {
  process.stderr.write(`${estyle.yellow(`Warning: ${msg}`)}\n`);
}

export function error(msg: string): void {
  process.stderr.write(`${estyle.red(`Error: ${msg}`)}\n`);
}

export function errorHint(msg: string): void {
  process.stderr.write(`${estyle.dim(msg)}\n`);
}
