/**
 * Nova extended thinking often streams literal `[REDACTED]` (Bedrock redacts
 * reasoning text). Detect / strip so UIs don't dump walls of placeholder tokens.
 *
 * @see https://docs.aws.amazon.com/nova/latest/userguide/extended-thinking.html
 */

const REDACTED_TOKEN = /\[REDACTED\]/gi;

/** True when the chunk is only redaction markers / punctuation / whitespace. */
export function isOpaqueReasoningText(text: string): boolean {
  const stripped = text.replace(REDACTED_TOKEN, '').replace(/[.\u2026…\s]+/g, '');
  return stripped.length === 0;
}

/**
 * Remove redaction markers. Returns empty string when nothing readable remains.
 */
export function stripOpaqueReasoningMarkers(text: string): string {
  const cleaned = text
    .replace(REDACTED_TOKEN, '')
    .replace(/[.\u2026…]{2,}/g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Leftover punctuation-only residue from "[REDACTED]. [REDACTED]" walls.
  if (!cleaned || /^[.\u2026…\s]+$/.test(cleaned)) return '';
  return cleaned;
}
