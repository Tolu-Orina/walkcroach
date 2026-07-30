import { describe, it, expect } from 'vitest';
import {
  MAX_HISTORY_POINTS,
  coercePrice,
  extractPriceFromText,
  nextPriceHistory,
  type PricePoint,
} from './price-track.js';

const at = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString();
const pt = (price: number, day: number, currency = 'GBP'): PricePoint => ({
  price,
  currency,
  at: at(day),
});

describe('nextPriceHistory — first check', () => {
  it('starts a history from nothing', () => {
    const { history, changed } = nextPriceHistory(undefined, pt(3.15, 1));
    expect(history).toEqual([pt(3.15, 1)]);
    expect(changed).toBe(true);
  });

  it('tolerates a corrupted structured_fields.history', () => {
    // Older rows predate the field, and jsonb can hold anything.
    const { history } = nextPriceHistory(
      'not an array' as unknown as PricePoint[],
      pt(3.15, 1),
    );
    expect(history).toEqual([pt(3.15, 1)]);
  });
});

describe('nextPriceHistory — unchanged price', () => {
  it('does not append a duplicate point', () => {
    // The bug this fixes: five visits used to write five identical points,
    // flattening the sparkline and making "checks" a measure of browsing.
    const { history, changed } = nextPriceHistory([pt(3.15, 1)], pt(3.15, 2));
    expect(history).toHaveLength(1);
    expect(changed).toBe(false);
  });

  it('moves the timestamp forward, because the price holding is information', () => {
    const { history } = nextPriceHistory([pt(3.15, 1)], pt(3.15, 9));
    expect(history[0]!.at).toBe(at(9));
    expect(history[0]!.price).toBe(3.15);
  });

  it('stays flat across many repeat visits', () => {
    let history: PricePoint[] = [];
    for (let day = 1; day <= 12; day++) {
      history = nextPriceHistory(history, pt(3.15, day)).history;
    }
    expect(history).toHaveLength(1);
    expect(history[0]!.at).toBe(at(12));
  });

  it('appends when only the currency changes', () => {
    // Same number, different currency, is a different price.
    const { history, changed } = nextPriceHistory(
      [pt(3.15, 1, 'GBP')],
      pt(3.15, 2, 'USD'),
    );
    expect(history).toHaveLength(2);
    expect(changed).toBe(true);
  });
});

describe('nextPriceHistory — movement', () => {
  it('appends a changed price', () => {
    const { history, changed } = nextPriceHistory([pt(3.15, 1)], pt(2.95, 2));
    expect(history.map((h) => h.price)).toEqual([3.15, 2.95]);
    expect(changed).toBe(true);
  });

  it('records a price that returns to an earlier value', () => {
    // Only the *last* point is compared, so a genuine A→B→A cycle is kept.
    let { history } = nextPriceHistory([pt(3.15, 1)], pt(2.95, 2));
    history = nextPriceHistory(history, pt(3.15, 3)).history;
    expect(history.map((h) => h.price)).toEqual([3.15, 2.95, 3.15]);
  });

  it('does not mutate the array it was given', () => {
    const original = [pt(3.15, 1)];
    nextPriceHistory(original, pt(2.95, 2));
    expect(original).toHaveLength(1);
  });
});

describe('nextPriceHistory — cap', () => {
  it('evicts the oldest point past the cap', () => {
    let history: PricePoint[] = [];
    for (let i = 1; i <= MAX_HISTORY_POINTS + 5; i++) {
      history = nextPriceHistory(history, {
        price: i,
        currency: 'GBP',
        at: at(1),
      }).history;
    }
    expect(history).toHaveLength(MAX_HISTORY_POINTS);
    expect(history[0]!.price).toBe(6);
    expect(history[history.length - 1]!.price).toBe(MAX_HISTORY_POINTS + 5);
  });

  it('no longer spends the cap on duplicates', () => {
    // Before the fix, 100 identical visits evicted every real data point.
    let history: PricePoint[] = [pt(9.99, 1)];
    for (let i = 0; i < 150; i++) {
      history = nextPriceHistory(history, pt(9.99, 2)).history;
    }
    history = nextPriceHistory(history, pt(8.5, 3)).history;
    expect(history.map((h) => h.price)).toEqual([9.99, 8.5]);
  });
});

describe('coercePrice', () => {
  it('passes through finite numbers', () => {
    expect(coercePrice(3.15)).toBe(3.15);
    expect(coercePrice(0)).toBe(0);
  });

  it('rejects non-finite numbers and non-strings', () => {
    expect(coercePrice(Number.NaN)).toBeNull();
    expect(coercePrice(Number.POSITIVE_INFINITY)).toBeNull();
    expect(coercePrice(null)).toBeNull();
    expect(coercePrice(undefined)).toBeNull();
    expect(coercePrice({})).toBeNull();
    expect(coercePrice([])).toBeNull();
  });

  it('strips currency symbols and thousands separators', () => {
    expect(coercePrice('£3.15')).toBe(3.15);
    expect(coercePrice('$1,299.00')).toBe(1299);
    expect(coercePrice(' 12.99 ')).toBe(12.99);
    expect(coercePrice('$12,345,678.90')).toBe(12345678.9);
  });

  it('reads a European decimal comma as a decimal, not a thousands group', () => {
    // Stripping every comma turned "45,50" into 4550 — a hundredfold error,
    // stored as a real price and plotted on the user's history.
    expect(coercePrice('EUR 45,50')).toBe(45.5);
    expect(coercePrice('€1.299,00')).toBe(1299);
    expect(coercePrice('1.234.567,89')).toBe(1234567.89);
  });

  it('still reads a comma before three digits as thousands', () => {
    expect(coercePrice('$1,299')).toBe(1299);
    expect(coercePrice('12,000')).toBe(12000);
  });

  it('treats a lone dot as decimal, the convention in our markets', () => {
    expect(coercePrice('1.299')).toBe(1.299);
  });

  it('returns null for strings with no number', () => {
    expect(coercePrice('Out of stock')).toBeNull();
    expect(coercePrice('')).toBeNull();
    expect(coercePrice('£')).toBeNull();
  });
});

describe('extractPriceFromText', () => {
  it('finds the first currency-marked price', () => {
    expect(extractPriceFromText('Now only £3.15 delivered')).toBe('3.15');
    expect(extractPriceFromText('Price: $1,299.00')).toBe('1,299.00');
    expect(extractPriceFromText('USD 45.50 each')).toBe('45.50');
    expect(extractPriceFromText('€22')).toBe('22');
  });

  it('returns null with no currency marker or no text', () => {
    expect(extractPriceFromText('2400 units, 18 working days')).toBeNull();
    expect(extractPriceFromText(undefined)).toBeNull();
    expect(extractPriceFromText('')).toBeNull();
  });

  it('feeds coercePrice, so a matched string becomes a number', () => {
    const raw = extractPriceFromText('Sale price $1,299.00 today');
    expect(coercePrice(raw)).toBe(1299);
  });
});
