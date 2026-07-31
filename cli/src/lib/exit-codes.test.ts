/**
 * Error → exit code mapping (C0.5).
 *
 * The distinction that matters in CI: 2 means "run `walkcroach auth login` and
 * try again", 4 means "the service or the network is down", and 1 means "you
 * typed something wrong". Collapsing all three into 1 makes an automated
 * retry policy impossible to write.
 */
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  AuthRequiredError,
  ERROR_CODES,
  EXIT,
  NetworkError,
  NoCredentialsError,
  errorToStructured,
  exitCodeForError,
} from './exit-codes.js';

describe('exitCodeForError', () => {
  it('maps a missing session to AUTH_REQUIRED', () => {
    expect(exitCodeForError(new AuthRequiredError())).toBe(EXIT.AUTH_REQUIRED);
  });

  it('maps a rejected session to AUTH_REQUIRED', () => {
    expect(exitCodeForError(new ApiError('expired', 401))).toBe(EXIT.AUTH_REQUIRED);
    expect(exitCodeForError(new ApiError('forbidden', 403))).toBe(EXIT.AUTH_REQUIRED);
  });

  it('maps a server-side failure to NETWORK, not USAGE', () => {
    expect(exitCodeForError(new ApiError('boom', 500))).toBe(EXIT.NETWORK);
    expect(exitCodeForError(new ApiError('gateway', 502))).toBe(EXIT.NETWORK);
    expect(exitCodeForError(new NetworkError('refused'))).toBe(EXIT.NETWORK);
  });

  it('maps a client mistake to USAGE', () => {
    expect(exitCodeForError(new ApiError('no such project', 404))).toBe(EXIT.USAGE);
    expect(exitCodeForError(new ApiError('bad body', 400))).toBe(EXIT.USAGE);
  });

  it('treats a fetch transport failure as NETWORK', () => {
    // Undici reports DNS/refused/TLS as a TypeError carrying `cause`.
    const err = new TypeError('fetch failed');
    (err as { cause?: unknown }).cause = { code: 'ECONNREFUSED' };
    expect(exitCodeForError(err)).toBe(EXIT.NETWORK);
  });

  it('does not mistake an ordinary TypeError for a network problem', () => {
    expect(exitCodeForError(new TypeError('x is not a function'))).toBe(EXIT.USAGE);
  });

  it('falls back to USAGE for anything unrecognised', () => {
    expect(exitCodeForError(new Error('unknown'))).toBe(EXIT.USAGE);
    expect(exitCodeForError('a string')).toBe(EXIT.USAGE);
  });
});

describe('AuthRequiredError', () => {
  it('tells the user the command that fixes it', () => {
    expect(new AuthRequiredError().message).toContain('walkcroach auth login');
  });
});


/**
 * Structured `--json` errors (C5.5).
 *
 * An exit code says *how* a command failed at the granularity a shell needs;
 * these say *why*, at the granularity a script needs.
 */
describe('errorToStructured', () => {
  it('classifies a missing session, with the command that fixes it', () => {
    const out = errorToStructured(new AuthRequiredError());
    expect(out.code).toBe(ERROR_CODES.auth_required);
    expect(out.hint).toContain('walkcroach auth login');
  });

  it('classifies a rejected session the same way as a missing one', () => {
    // A script retrying after `auth login` should treat both identically.
    expect(errorToStructured(new ApiError('expired', 401)).code).toBe(
      ERROR_CODES.auth_required,
    );
  });

  it('separates a server failure from a client mistake', () => {
    expect(errorToStructured(new ApiError('boom', 503)).code).toBe(ERROR_CODES.network);
    expect(errorToStructured(new ApiError('no such project', 404)).code).toBe(
      ERROR_CODES.api_error,
    );
  });

  it('classifies unconfigured BYOK distinctly from an auth failure', () => {
    // Different fix, different retry policy: signing in does not help.
    const out = errorToStructured(
      new NoCredentialsError('no credentials', 'Run: walkcroach secrets set bedrock.apiKey'),
    );
    expect(out.code).toBe(ERROR_CODES.no_credentials);
    expect(out.hint).toContain('secrets set');
    expect(exitCodeForError(new NoCredentialsError('x'))).toBe(EXIT.USAGE);
  });

  it('never disagrees with the exit code', () => {
    // A payload saying auth_required beside exit 4 would be worse than either
    // signal alone.
    const cases: Array<[unknown, number, string]> = [
      [new AuthRequiredError(), EXIT.AUTH_REQUIRED, ERROR_CODES.auth_required],
      [new NetworkError('refused'), EXIT.NETWORK, ERROR_CODES.network],
      [new ApiError('bad', 400), EXIT.USAGE, ERROR_CODES.api_error],
      [new ApiError('down', 500), EXIT.NETWORK, ERROR_CODES.network],
      [new ApiError('nope', 403), EXIT.AUTH_REQUIRED, ERROR_CODES.auth_required],
    ];
    for (const [err, exit, code] of cases) {
      expect(exitCodeForError(err)).toBe(exit);
      expect(errorToStructured(err).code).toBe(code);
    }
  });

  it('always carries a message, even for a thrown non-Error', () => {
    expect(errorToStructured('a string').message).toBe('a string');
    expect(errorToStructured(new Error('boom')).message).toBe('boom');
  });

  it('falls back to `unknown` rather than guessing', () => {
    expect(errorToStructured(new Error('mystery')).code).toBe(ERROR_CODES.unknown);
  });
});
