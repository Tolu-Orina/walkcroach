export type PricePoint = { price: number; currency: string; at: string };

/**
 * In-panel price history.
 *
 * A sparkline rather than a table: at 250px a table wraps into noise, and the
 * question a user actually has is "is this cheaper than when I saved it?" —
 * which is shape plus a delta, not eleven rows of numbers.
 *
 * The chart is `aria-hidden` and paired with a text summary, because a
 * screen-reader user needs the delta, not the polyline.
 */
export function PriceHistory({
  history,
  priceChanged,
}: {
  history: PricePoint[];
  /** False when this check found the same price as the previous one. */
  priceChanged?: boolean;
}) {
  if (!history.length) return null;

  const points = [...history].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
  const latest = points[points.length - 1]!;
  const first = points[0]!;
  const prices = points.map((p) => p.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);

  const delta = latest.price - first.price;
  const pct = first.price > 0 ? (delta / first.price) * 100 : 0;
  const moved = points.length > 1 && delta !== 0;
  const atLowest = points.length > 1 && latest.price === low && low !== high;

  return (
    <section className="wc-section" aria-label="Price history">
      <div className="wc-price">
        <span className="wc-price__now">
          {latest.currency} {formatPrice(latest.price)}
        </span>
        {moved && (
          <span
            className={
              delta < 0
                ? 'wc-small wc-mono wc-price__delta--down'
                : 'wc-small wc-mono wc-price__delta--up'
            }
          >
            {delta < 0 ? '▼' : '▲'} {formatPrice(Math.abs(delta))} (
            {Math.abs(pct).toFixed(1)}%)
          </span>
        )}
      </div>

      {points.length > 1 && <Sparkline points={points} />}

      {/* Text equivalent of the chart, which is aria-hidden. */}
      <p className="wc-muted wc-small">
        {describeHistory({
          points: points.length,
          firstAt: first.at,
          currency: latest.currency,
          first: first.price,
          low,
          high,
          moved,
          delta,
          priceChanged,
        })}
      </p>

      {atLowest && (
        <p className="wc-note wc-small">
          Lowest price since you started tracking this.
        </p>
      )}
    </section>
  );
}

/**
 * Pure and exported so the wording is testable without a DOM.
 *
 * History now records price *changes*, not visits (see `nextPriceHistory` on the
 * BFF), so the copy had to stop saying "12 checks" — that used to count how often
 * the user opened the page.
 */
export function describeHistory(input: {
  points: number;
  firstAt: string;
  currency: string;
  first: number;
  low: number;
  high: number;
  moved: boolean;
  delta: number;
  priceChanged?: boolean;
}): string {
  const {
    points,
    firstAt,
    currency,
    first,
    low,
    high,
    moved,
    delta,
    priceChanged,
  } = input;

  if (points === 1) {
    // One point means either a brand-new track or a price that has never moved.
    return priceChanged === false
      ? `No change since you started tracking on ${formatDate(firstAt)}.`
      : `Tracking from ${formatDate(firstAt)}. Check back to build history.`;
  }

  const parts = [
    `${points - 1} ${points - 1 === 1 ? 'change' : 'changes'} since ${formatDate(firstAt)}`,
    moved
      ? `${delta < 0 ? 'down' : 'up'} from ${currency} ${formatPrice(first)}`
      : null,
    low !== high
      ? `range ${currency} ${formatPrice(low)}–${formatPrice(high)}`
      : null,
  ].filter(Boolean);

  const sentence = `${parts.join(' · ')}.`;
  return priceChanged === false ? `${sentence} No change this check.` : sentence;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? 'an earlier check'
    : d.toLocaleDateString();
}

/** Normalised to a 100×32 viewBox and stretched by CSS — no measuring needed. */
function Sparkline({ points }: { points: PricePoint[] }) {
  const values = points.map((p) => p.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = points.length > 1 ? 100 / (points.length - 1) : 0;

  const coords = values.map((v, i) => {
    const x = i * stepX;
    // 2px padding top and bottom so the stroke is never clipped.
    const y = 30 - ((v - min) / span) * 28;
    return [x, y] as const;
  });

  const line = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `0,32 ${line} 100,32`;

  /*
    `preserveAspectRatio="none"` stretches the 100×32 viewBox to the panel width,
    which is what makes the chart fill a resizable column. Stroke width survives
    via `non-scaling-stroke`, but any circle marker would be stretched into an
    oval — the scale factor is not knowable in CSS — so there is no end dot. The
    current price is printed directly above, which is the information it carried.
  */
  return (
    <svg
      className="wc-spark"
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <polygon className="wc-spark__area" points={area} />
      <polyline className="wc-spark__line" points={line} />
    </svg>
  );
}

function formatPrice(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
