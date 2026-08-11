/**
 * Format project-memory recall hits for human CLI output (P4).
 * Every line leads with source_surface so cross-surface provenance is visible.
 */
export function formatMemoryHitsText(
  hits: Array<{
    sourceSurface?: string;
    kind?: string;
    text?: string;
    relevance?: number;
  }>,
): string {
  if (!hits.length) return '(no matching project memory)';
  return hits
    .map((h, i) => {
      const surface = (h.sourceSurface ?? '?').toLowerCase();
      const kind = h.kind ? ` · ${h.kind}` : '';
      const score =
        typeof h.relevance === 'number'
          ? ` · ${h.relevance.toFixed(2)}`
          : '';
      const text = (h.text ?? '').replace(/\s+/g, ' ').trim();
      return `${i + 1}. [${surface}${kind}${score}] ${text}`;
    })
    .join('\n');
}
