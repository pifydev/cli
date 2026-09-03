/**
 * Exit codes. Distinct codes let CI distinguish "your environment is wrong"
 * from "the thing you asked for does not exist".
 */
export const ExitCode = {
  OK: 0,
  /** Generic / unexpected failure. */
  FAILURE: 1,
  /** Bad arguments, unknown command, malformed package name. */
  USAGE: 2,
  /** A required external program (pi, npm, node) is missing or too old. */
  ENVIRONMENT: 3,
  /** The requested package is not in the catalog or not yet published. */
  NOT_FOUND: 4,
  /** A delegated `pi` or `npm` subprocess exited non-zero. */
  SUBPROCESS: 5,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** An error we produced deliberately: message is user-facing, no stack trace. */
export class PifyError extends Error {
  readonly code: ExitCodeValue;
  /** Optional follow-up shown after the message, e.g. a command to run. */
  readonly hint?: string;

  constructor(message: string, code: ExitCodeValue = ExitCode.FAILURE, hint?: string) {
    super(message);
    this.name = "PifyError";
    this.code = code;
    this.hint = hint;
  }
}

export function usageError(message: string, hint?: string): PifyError {
  return new PifyError(message, ExitCode.USAGE, hint);
}

export function environmentError(message: string, hint?: string): PifyError {
  return new PifyError(message, ExitCode.ENVIRONMENT, hint);
}

export function notFoundError(message: string, hint?: string): PifyError {
  return new PifyError(message, ExitCode.NOT_FOUND, hint);
}
