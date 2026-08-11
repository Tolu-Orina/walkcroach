/**
 * Shared UI error messages for the side panel.
 *
 * Network failures and developer fallbacks (`bootstrap failed`, `malformed…`)
 * must never reach the user raw — every string is a situation + a next step.
 */

const NETWORK_MARKERS = [
  'Failed to fetch',
  'NetworkError when attempting to fetch resource.',
  'NetworkError',
  'Load failed',
] as const;

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message || '';
  if (typeof err === 'string') return err;
  return '';
}

export function isNetworkFailure(err: unknown): boolean {
  const msg = rawMessage(err);
  if (!msg) return false;
  return NETWORK_MARKERS.some(
    (marker) => msg === marker || msg.includes(marker),
  );
}

/**
 * Recoverable connectivity failure. Prefer this when the user can retry.
 */
export function formatNetworkError(
  err: unknown,
  fallback = 'Couldn’t complete that request. Try again.',
): string {
  if (isNetworkFailure(err)) {
    return 'Can’t reach the WalkCroach service. Check your network, then try again.';
  }
  if (!(err instanceof Error)) return fallback;
  return err.message || fallback;
}

/** Exact developer / protocol strings → user copy. */
const EXACT_UI_ERRORS: Record<string, string> = {
  'malformed stream chunk':
    'The answer stopped mid-stream. Try again.',
  'Credits response was malformed.':
    'Couldn’t load credits. Check your connection, then try again.',
  'bootstrap failed':
    'Couldn’t connect to WalkCroach. Check your network, then try again.',
  'list captures failed':
    'Couldn’t load captures. Try again.',
  'stream failed':
    'The answer stopped. Try again.',
  'summarize failed':
    'Couldn’t summarize this page. Try again.',
  'propose failed':
    'Couldn’t prepare that save. Try again.',
  'save failed':
    'Couldn’t save that. Check your connection, then try again.',
  'create workspace failed':
    'Couldn’t create the workspace. Try again.',
  'link failed':
    'Couldn’t link that project. Try again.',
  'sign-in failed':
    'Couldn’t complete sign-in. Try again.',
  'sign-out failed':
    'Couldn’t sign out. Try again.',
  'could not disconnect':
    'Couldn’t disconnect that account. Try again.',
  'Remember failed':
    'Couldn’t save that note. Try again.',
  'text required': 'Nothing to insert.',
  unhandled: 'Something went wrong. Try again.',
  'could not encode the screenshot':
    'Couldn’t capture the screenshot. Try again.',
};

const PATTERN_UI_ERRORS: Array<{ test: RegExp; message: string }> = [
  {
    test: /^malformed stream/i,
    message: 'The answer stopped mid-stream. Try again.',
  },
  {
    test: /credits response was malformed/i,
    message: 'Couldn’t load credits. Check your connection, then try again.',
  },
  {
    test: /could not encode the screenshot/i,
    message: 'Couldn’t capture the screenshot. Try again.',
  },
  {
    test: /device session failed/i,
    message:
      'Couldn’t start a session. Check your network, then try again.',
  },
  {
    test: /health failed/i,
    message:
      'Couldn’t reach WalkCroach. Check your network, then try again.',
  },
  {
    test: /^sign-in failed/i,
    message: 'Couldn’t complete sign-in. Try again.',
  },
  {
    test: /oauth (token|refresh|revoke) failed/i,
    message: 'Couldn’t complete sign-in. Try again.',
  },
  {
    test: /\bfailed:\s*\d{3}\b/i,
    message:
      'Something went wrong talking to WalkCroach. Try again in a moment.',
  },
  {
    // Bare developer fallbacks: "foo failed" / "foo_bar failed"
    test: /^[a-z][a-z0-9 _-]* failed\.?$/i,
    message: '', // resolved via fallback argument
  },
];

/**
 * Humanize any error before it hits the panel.
 * Prefer a specific `fallback` at each call site; known internals map first.
 */
export function formatUiError(
  err: unknown,
  fallback: string,
): string {
  if (isNetworkFailure(err)) {
    return formatNetworkError(err, fallback);
  }

  const msg = rawMessage(err);
  if (!msg) return fallback;

  const exact = EXACT_UI_ERRORS[msg];
  if (exact) return exact;

  for (const { test, message } of PATTERN_UI_ERRORS) {
    if (!test.test(msg)) continue;
    return message || fallback;
  }

  return msg;
}
