import { describe, it, expect } from 'vitest';
import { formatNetworkError } from './errors';

describe('formatNetworkError', () => {
  it('maps Failed to fetch to a recoverable message', () => {
    expect(formatNetworkError(new Error('Failed to fetch'))).toMatch(/Retry/i);
  });

  it('passes through other errors', () => {
    expect(formatNetworkError(new Error('device session failed: 503'))).toBe(
      'device session failed: 503',
    );
  });

  it('handles non-Error', () => {
    expect(formatNetworkError('x')).toBe('Request failed');
  });
});
