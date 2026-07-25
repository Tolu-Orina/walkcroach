/**
 * Shared network / API error messages for the side panel.
 */
export function formatNetworkError(err: unknown, fallback = 'Request failed'): string {
  if (!(err instanceof Error)) return fallback;
  const msg = err.message || fallback;
  if (
    msg === 'Failed to fetch' ||
    msg === 'NetworkError when attempting to fetch resource.' ||
    msg.includes('NetworkError') ||
    msg.includes('Load failed')
  ) {
    return 'Can’t reach the WalkCroach service. Check your network, then tap Retry.';
  }
  return msg;
}
