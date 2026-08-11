/** Shared markers for verify-review and architecture-critic subagents. */

export const REVIEW_OK_MARKER = 'REVIEW_OK';

export function isReviewOk(summary: string): boolean {
  const first = summary.trim().split(/\r?\n/)[0]?.trim() ?? '';
  return (
    first === REVIEW_OK_MARKER ||
    first.startsWith(`${REVIEW_OK_MARKER} `) ||
    first.startsWith(`${REVIEW_OK_MARKER}:`)
  );
}
