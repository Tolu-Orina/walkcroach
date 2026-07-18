/** Truncate tool results / context blobs for the model (impl plan §7). */

export const DEFAULT_TOOL_RESULT_MAX_CHARS = 40_000;
export const DEFAULT_WALK_CROACH_MD_MAX_CHARS = 12_000;

export function truncateText(
  text: string,
  maxChars = DEFAULT_TOOL_RESULT_MAX_CHARS,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const keep = Math.max(0, maxChars - 80);
  return {
    text: `${text.slice(0, keep)}\n\n…[truncated ${text.length - keep} chars]`,
    truncated: true,
  };
}
