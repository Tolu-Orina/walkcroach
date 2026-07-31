/**
 * The CLI's exit-code contract (C0.5).
 *
 * Scripts branch on these, so they are as much a public interface as the flags
 * are. Adding a code is additive; changing what an existing one means is not.
 *
 * A command must return one of these rather than a bare `1`, because "it
 * failed" and "you are not signed in" call for different handling in a CI job:
 * one is worth retrying after `auth login`, the other is not.
 */
export const EXIT = {
  /** Success. */
  OK: 0,
  /** Bad flags, bad arguments, or input that failed validation. */
  USAGE: 1,
  /** Needs a signed-in session, or the session was rejected (401/403). */
  AUTH_REQUIRED: 2,
  /** The agent run itself failed or was rejected — the CLI worked fine. */
  RUN_FAILED: 3,
  /** The API was unreachable, timed out, or returned 5xx. */
  NETWORK: 4,
  /** Interrupted by SIGINT. 128 + 2, the shell convention. */
  INTERRUPTED: 130,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Raised when a command needs a token it does not have. */
export class AuthRequiredError extends Error {
  readonly exitCode = EXIT.AUTH_REQUIRED;
  constructor(message = 'Not signed in. Run: walkcroach auth login') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

/** Raised when the API could not be reached or failed on its side. */
export class NetworkError extends Error {
  readonly exitCode = EXIT.NETWORK;
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** Raised when the API answered, but with a failure status. */
export class ApiError extends Error {
  readonly name = 'ApiError';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Stable, machine-readable error codes for `--json` output (C5.5).
 *
 * An exit code says how a command failed at the granularity a shell needs;
 * these say *why*, at the granularity a script needs. They are part of the
 * public surface: a caller branching on `code === 'auth_required'` must keep
 * working, so codes are added, never renamed.
 *
 * Deliberately not the same thing as the exit codes: several distinct causes
 * share exit 1, and telling them apart is exactly the point.
 */
export const ERROR_CODES = {
  /** Bad flags, arguments, or input that failed validation. */
  usage: 'usage',
  /** No session, or one the API rejected. Retry after `walkcroach auth login`. */
  auth_required: 'auth_required',
  /** The API was unreachable, timed out, or failed on its side. Retryable. */
  network: 'network',
  /** The API understood the request and refused it. Not retryable as-is. */
  api_error: 'api_error',
  /** The agent run itself failed. */
  run_failed: 'run_failed',
  /** No inference credentials — BYOK is not configured. */
  no_credentials: 'no_credentials',
  /** Anything not yet classified. */
  unknown: 'unknown',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** A failure, in the shape `--json` consumers read. */
export type StructuredError = {
  code: ErrorCode;
  message: string;
  /** One actionable sentence, when there is one. */
  hint?: string;
};

/** Raised when nothing can run because BYOK is unconfigured. */
export class NoCredentialsError extends Error {
  readonly name = 'NoCredentialsError';
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

/**
 * Classify a thrown value for `--json`.
 *
 * Mirrors `exitCodeForError` so the two never disagree — a payload saying
 * `auth_required` beside exit code 1 would be worse than either alone.
 */
export function errorToStructured(err: unknown): StructuredError {
  const message = err instanceof Error ? err.message : String(err);

  if (err instanceof NoCredentialsError) {
    return { code: ERROR_CODES.no_credentials, message, hint: err.hint };
  }
  if (err instanceof AuthRequiredError) {
    return {
      code: ERROR_CODES.auth_required,
      message,
      hint: 'Run: walkcroach auth login',
    };
  }
  if (err instanceof NetworkError) {
    return {
      code: ERROR_CODES.network,
      message,
      hint: 'Check connectivity, then `walkcroach doctor` to see which API is being used.',
    };
  }
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      return {
        code: ERROR_CODES.auth_required,
        message,
        hint: 'Your session was rejected. Run: walkcroach auth login',
      };
    }
    if (err.status >= 500) {
      return {
        code: ERROR_CODES.network,
        message,
        hint: 'The API failed on its side. Retry shortly.',
      };
    }
    return { code: ERROR_CODES.api_error, message };
  }
  if (err instanceof TypeError && 'cause' in err && err.cause !== undefined) {
    return { code: ERROR_CODES.network, message };
  }
  return { code: ERROR_CODES.unknown, message };
}

/**
 * Map a thrown value to the code the process should exit with.
 *
 * `fetch` reports every transport failure — DNS, refused connection, TLS — as a
 * `TypeError` with a `cause`, which is indistinguishable from a programming
 * error by type alone. Treating that as NETWORK is the useful reading: a CLI
 * user hitting it has a connectivity problem, not a bug to report.
 */
export function exitCodeForError(err: unknown): ExitCode {
  // Not configured is a usage problem the user can fix, not an auth failure
  // against the WalkCroach API — a CI job should not retry it after signing in.
  if (err instanceof NoCredentialsError) return EXIT.USAGE;
  if (err instanceof AuthRequiredError) return EXIT.AUTH_REQUIRED;
  if (err instanceof NetworkError) return EXIT.NETWORK;
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) return EXIT.AUTH_REQUIRED;
    if (err.status >= 500) return EXIT.NETWORK;
    return EXIT.USAGE;
  }
  if (err instanceof TypeError && 'cause' in err && err.cause !== undefined) {
    return EXIT.NETWORK;
  }
  return EXIT.USAGE;
}
