/**
 * Credential scrubbing for anything the CLI prints about *itself* (C0.7).
 *
 * ## Where this applies, and deliberately where it does not
 *
 * Applied to: command payloads (`doctor`, `auth status`, `config`), error
 * messages, and agent `error` events. These are the paths that carry our own
 * configuration, and the ones where a token can leak into a terminal, a CI log,
 * or a pasted bug report without anyone intending it.
 *
 * NOT applied to the model's token stream or to approval previews. Those are
 * the user's own content being shown back to them: an approval card exists so
 * they can read exactly what is about to happen, and redacting a diff would
 * damage the one thing that makes the gate meaningful. Generated code that
 * happens to contain an `AKIA…`-shaped literal must survive intact.
 *
 * So the rule is: scrub what the CLI says, not what the CLI is asked to show.
 */

export const REDACTED = '«redacted»';

/** Key names whose *value* is a secret regardless of what it looks like. */
const SENSITIVE_KEY = /(token|secret|password|passwd|credential|authorization|api[-_]?key|refresh|private[-_]?key)/i;

/**
 * Value patterns worth catching even under an innocent key — a token pasted
 * into an error message has no key at all.
 */
const PATTERNS: Array<[RegExp, string]> = [
  // `Bearer <anything>` in a header echo or an error string.
  [/\bBearer\s+[\w.\-~+/]+=*/gi, `Bearer ${REDACTED}`],
  // JWTs (Cognito access/id tokens): three base64url segments, header first.
  [/\beyJ[\w-]{8,}\.[\w-]+\.[\w-]+/g, REDACTED],
  // AWS access key IDs. AKIA = long-lived, ASIA = STS session.
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  // OAuth authorization codes we mint for the sign-in handoff.
  [/\bwc_(?:code|rt)_[A-Za-z0-9_-]{8,}/g, REDACTED],
];

/** Scrub secrets out of a single string. */
export function redactString(input: string): string {
  let out = input;
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Recursively scrub a value of any shape.
 *
 * Cycles are tracked because command payloads are assembled from API responses
 * and config objects, and a cycle here would hang the process on the way to
 * printing an error — the worst possible moment.
 */
export function redact<T>(value: T): T {
  return walk(value, new WeakSet()) as T;
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => walk(item, seen));

  if (value instanceof Error) {
    // Errors do not survive a spread; rebuild the parts we print.
    const copy = new Error(redactString(value.message));
    copy.name = value.name;
    return copy;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    // A sensitive-sounding key redacts its *string* value, because that is
    // what a credential is. Booleans and numbers under the same key —
    // `hasApiKey: true`, `tokenCount: 3` — carry nothing to leak, and
    // blanking them turns useful reports into noise.
    if (SENSITIVE_KEY.test(key) && typeof item === 'string') {
      out[key] = REDACTED;
      continue;
    }
    // Objects and arrays keep being walked even under a sensitive key, so a
    // real secret nested inside is still caught by its own key or by pattern.
    out[key] = walk(item, seen);
  }
  return out;
}
