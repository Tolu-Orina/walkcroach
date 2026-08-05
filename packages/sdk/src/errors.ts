/**
 * Typed error hierarchy.
 *
 * Every error carries `requestId` where the server supplied one, so a caller's
 * bug report is traceable in CloudWatch without guesswork.
 */

export class WalkCroachError extends Error {
  readonly status: number;
  readonly requestId: string | null;
  /** True when retrying the identical request could plausibly succeed. */
  readonly retryable: boolean = false;

  constructor(message: string, status: number, requestId: string | null = null) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.requestId = requestId;
  }
}

/** 401/403 — missing, invalid, revoked, or under-scoped credentials. */
export class AuthError extends WalkCroachError {}

/** 400 — the request was understood and is wrong. Never retryable. */
export class ValidationError extends WalkCroachError {
  /** Set when the server identified a specific offending field. */
  readonly field: string | null;
  /** e.g. `RETENTION_WINDOW_EXCEEDED` for an `asOf` beyond the GC window. */
  readonly code: string | null;

  constructor(
    message: string,
    status = 400,
    requestId: string | null = null,
    opts: { field?: string | null; code?: string | null } = {},
  ) {
    super(message, status, requestId);
    this.field = opts.field ?? null;
    this.code = opts.code ?? null;
  }
}

/**
 * 404 — no such resource, *or* a resource belonging to another tenant.
 *
 * The API deliberately does not distinguish those two: returning 403 for
 * "exists but not yours" would let a caller enumerate other tenants' project
 * ids. Do not add a `NotYoursError`.
 */
export class NotFoundError extends WalkCroachError {}

/** 429 — rate limited. */
export class QuotaError extends WalkCroachError {
  override readonly retryable = true;
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    status = 429,
    requestId: string | null = null,
    retryAfterMs: number | null = null,
  ) {
    super(message, status, requestId);
    this.retryAfterMs = retryAfterMs;
  }
}

/** Network failure, timeout, or 502/503/504. Safe to retry. */
export class TransientError extends WalkCroachError {
  override readonly retryable = true;
}

/**
 * 500 — deliberately NOT retryable.
 *
 * A 500 from a write path may well have committed before failing to respond;
 * replaying it could duplicate a memory entry. Same reasoning as the db client's
 * refusal to retry ambiguous connection errors.
 */
export class ServerError extends WalkCroachError {}

export function errorFromResponse(
  status: number,
  body: unknown,
  requestId: string | null,
  retryAfterMs: number | null,
): WalkCroachError {
  const rec = (body ?? {}) as Record<string, unknown>;
  const message =
    (typeof rec.error === 'string' && rec.error) ||
    (typeof rec.message === 'string' && rec.message) ||
    `request failed with status ${status}`;
  const code = typeof rec.code === 'string' ? rec.code : null;
  const field = typeof rec.field === 'string' ? rec.field : null;

  if (status === 401 || status === 403) return new AuthError(message, status, requestId);
  if (status === 404) return new NotFoundError(message, status, requestId);
  if (status === 429) return new QuotaError(message, status, requestId, retryAfterMs);
  if (status === 400 || status === 422) {
    return new ValidationError(message, status, requestId, { code, field });
  }
  if (status === 502 || status === 503 || status === 504) {
    return new TransientError(message, status, requestId);
  }
  return new ServerError(message, status, requestId);
}
