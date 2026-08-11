import { describe, it, expect } from 'vitest';
import {
  formatNetworkError,
  formatUiError,
  isNetworkFailure,
} from './errors';

describe('formatNetworkError', () => {
  it('maps Failed to fetch to a recoverable message', () => {
    expect(formatNetworkError(new Error('Failed to fetch'))).toMatch(
      /try again/i,
    );
    expect(formatNetworkError(new Error('Failed to fetch'))).not.toMatch(
      /tap/i,
    );
  });

  it('passes through other errors', () => {
    expect(formatNetworkError(new Error('device session failed: 503'))).toBe(
      'device session failed: 503',
    );
  });

  it('handles non-Error', () => {
    expect(formatNetworkError('x')).toBe(
      'Couldn’t complete that request. Try again.',
    );
  });
});

describe('formatUiError', () => {
  it('detects network failures', () => {
    expect(isNetworkFailure(new Error('Failed to fetch'))).toBe(true);
    expect(
      formatUiError(new Error('Failed to fetch'), 'fallback'),
    ).toMatch(/Can’t reach the WalkCroach service/);
  });

  it('maps malformed stream and credits internals', () => {
    expect(
      formatUiError(new Error('malformed stream chunk'), 'fallback'),
    ).toMatch(/stopped mid-stream/i);
    expect(
      formatUiError(new Error('Credits response was malformed.'), 'fallback'),
    ).toMatch(/Couldn’t load credits/i);
  });

  it('maps bare developer fallbacks to the call-site fallback', () => {
    expect(formatUiError(new Error('bootstrap failed'), 'Connect failed.')).toBe(
      'Couldn’t connect to WalkCroach. Check your network, then try again.',
    );
    expect(
      formatUiError(new Error('save failed'), 'Couldn’t save that. Try again.'),
    ).toMatch(/Couldn’t save/i);
  });

  it('maps status-style API failures', () => {
    expect(
      formatUiError(
        new Error('device session failed: 503'),
        'Couldn’t start a session. Try again.',
      ),
    ).toMatch(/Couldn’t start a session/i);
  });

  it('keeps already-human messages', () => {
    expect(
      formatUiError(
        new Error('Could not insert — focus a text field on the page, then try again.'),
        'fallback',
      ),
    ).toMatch(/focus a text field/);
  });
});
