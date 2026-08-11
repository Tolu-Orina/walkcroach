import type { RecallSource } from '../../../lib/api';

/**
 * The captures an answer was built from (Phase D5).
 *
 * Recall previously asked the model to cite its sources in prose and left it
 * there — so an answer was unauditable: the user could not tell which saved page
 * a claim came from, or whether the model had simply improvised. Numbering these
 * to match the `[2]` markers in the answer makes the memory graph legible.
 *
 * Each row also carries where the capture lives, which is the cross-surface
 * promise made concrete: `also in Web` means the same memory is available in a
 * linked WalkCroach Web project.
 */
export function RecallSources({ sources }: { sources: RecallSource[] }) {
  if (!sources.length) return null;

  return (
    <section className="wc-section" aria-labelledby="wc-sources-title">
      <h3 className="wc-eyebrow" id="wc-sources-title">
        Answered from {sources.length}{' '}
        {sources.length === 1 ? 'capture' : 'captures'}
      </h3>
      <ol className="wc-sources">
        {sources.map((source, i) => (
          <li key={source.captureId} className="wc-sources__item">
            <span className="wc-sources__index" aria-hidden="true">
              {i + 1}
            </span>
            <div className="wc-list__body">
              <a
                className="wc-sources__link"
                href={source.url}
                target="_blank"
                rel="noreferrer"
                title={source.url}
              >
                {source.title || source.url}
              </a>
              <span className="wc-sources__meta">
                <span className="wc-sector">{labelType(source.captureType)}</span>
                {source.workspace && <span>{source.workspace}</span>}
                {source.inWebProject && (
                  <span className="wc-sources__mirror">also in Web</span>
                )}
                <span className="wc-mono">{formatWhen(source.capturedAt)}</span>
              </span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** `capture_type` values are storage keys; these are the user-facing words. */
export function labelType(captureType: string): string {
  switch (captureType) {
    case 'candidate':
      return 'candidate';
    case 'lead':
      return 'lead';
    case 'price':
      return 'price';
    case 'listing':
      return 'listing';
    case 'selection':
      return 'selection';
    case 'draft':
      return 'draft';
    default:
      return 'page';
  }
}

/** Relative for recent saves, absolute once "N days ago" stops being useful. */
export function formatWhen(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((now - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}
