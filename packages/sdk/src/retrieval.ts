import type { RecallHit } from './types.js';

/** Matches server clamp on `POST /v1/memory/recall`. */
export const RECALL_LIMIT_DEFAULT = 5;
export const RECALL_LIMIT_MAX = 20;

/**
 * Clamp a requested recall limit to the public API window (1–20, default 5).
 * Use before calling `memory.recall` when the limit comes from untrusted input.
 */
export function clampRecallLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return RECALL_LIMIT_DEFAULT;
  return Math.min(Math.max(Math.floor(limit), 1), RECALL_LIMIT_MAX);
}

export type PromptHitBudget = {
  /** Max hits to keep (after relevance order). Default 5. */
  maxHits?: number;
  /** Soft char budget across formatted lines; truncates last hit if needed. */
  maxChars?: number;
};

/**
 * Pick how many recall hits to inject into a system prompt.
 * Hits are assumed already relevance-ordered (as returned by `recall`).
 */
export function selectHitsForPrompt(
  hits: readonly RecallHit[],
  budget: PromptHitBudget = {},
): RecallHit[] {
  const maxHits = Math.min(
    Math.max(budget.maxHits ?? RECALL_LIMIT_DEFAULT, 0),
    RECALL_LIMIT_MAX,
  );
  if (maxHits === 0 || hits.length === 0) return [];

  const maxChars = budget.maxChars;
  const out: RecallHit[] = [];
  let used = 0;
  for (const hit of hits) {
    if (out.length >= maxHits) break;
    const line = formatHitLine(hit);
    if (maxChars !== undefined && used + line.length > maxChars && out.length > 0) {
      break;
    }
    if (maxChars !== undefined && line.length > maxChars && out.length === 0) {
      out.push({
        ...hit,
        text:
          hit.text.length > maxChars
            ? `${hit.text.slice(0, Math.max(0, maxChars - 1))}…`
            : hit.text,
      });
      break;
    }
    out.push(hit);
    used += line.length + 1;
  }
  return out;
}

function formatHitLine(hit: RecallHit): string {
  return `- [${hit.kind}] ${hit.text}`;
}

/**
 * Format recall hits as a system-prompt block (same shape as the first-party harness).
 */
export function formatHitsForPrompt(
  hits: readonly RecallHit[],
  opts: { heading?: string; budget?: PromptHitBudget } = {},
): string {
  const selected = selectHitsForPrompt(hits, opts.budget ?? {});
  if (selected.length === 0) return '';
  const heading = opts.heading ?? 'Project memory (use when relevant):';
  return `${heading}\n${selected.map(formatHitLine).join('\n')}`;
}
