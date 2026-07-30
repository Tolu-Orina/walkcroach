import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MAX_SELECTION_CHARS,
  isUsableSelection,
  normalizeSelection,
  putPendingSelection,
  takePendingSelection,
  type PendingSelection,
} from './selection';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  globalThis.chrome = {
    storage: {
      session: {
        get: vi.fn(async (key: string) =>
          key in store ? { [key]: store[key] } : {},
        ),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
        remove: vi.fn(async (key: string) => {
          delete store[key];
        }),
      },
    },
  } as unknown as typeof chrome;
});

const selection = (over: Partial<PendingSelection> = {}): PendingSelection => ({
  text: 'Lead time is eighteen working days from receipt of a purchase order.',
  url: 'https://northwind.test/q/4471',
  title: 'Quote Q-4471',
  truncated: false,
  capturedAt: 1,
  ...over,
});

describe('normalizeSelection', () => {
  it('collapses runs of spaces and tabs', () => {
    expect(normalizeSelection('a   \t  b')).toBe('a b');
  });

  it('keeps paragraph breaks, which carry meaning in a quote', () => {
    expect(normalizeSelection('para one\n\npara two')).toBe(
      'para one\n\npara two',
    );
  });

  it('collapses excessive blank lines', () => {
    expect(normalizeSelection('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('strips control characters', () => {
    const raw = `before${String.fromCharCode(0, 7, 27)}after`;
    expect(normalizeSelection(raw)).toBe('before after');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeSelection('  \n hello \n ')).toBe('hello');
  });

  it('caps a very long selection', () => {
    const out = normalizeSelection('x'.repeat(MAX_SELECTION_CHARS + 500));
    expect(out.length).toBeLessThanOrEqual(MAX_SELECTION_CHARS + 1);
    expect(out.endsWith('\u2026')).toBe(true);
  });

  it('leaves a selection at the cap untouched', () => {
    const out = normalizeSelection('x'.repeat(MAX_SELECTION_CHARS));
    expect(out.endsWith('\u2026')).toBe(false);
  });
});

describe('isUsableSelection', () => {
  it('accepts a real quote', () => {
    expect(isUsableSelection('eighteen working days')).toBe(true);
  });

  it('rejects a stray double-click or empty selection', () => {
    // Chrome fires the menu item for any selection, including one word.
    expect(isUsableSelection('the')).toBe(false);
    expect(isUsableSelection('   ')).toBe(false);
    expect(isUsableSelection('')).toBe(false);
  });

  it('measures the normalised length, not the raw string', () => {
    expect(isUsableSelection('a' + ' '.repeat(50) + 'b')).toBe(false);
  });
});

describe('pending selection queue', () => {
  it('round-trips a selection', async () => {
    await putPendingSelection(selection());
    await expect(takePendingSelection()).resolves.toMatchObject({
      title: 'Quote Q-4471',
      truncated: false,
    });
  });

  it('is a queue of one — taking it clears it', async () => {
    // Otherwise reopening the panel would re-offer the same confirm card.
    await putPendingSelection(selection());
    await takePendingSelection();
    await expect(takePendingSelection()).resolves.toBeNull();
  });

  it('returns null when nothing is queued', async () => {
    await expect(takePendingSelection()).resolves.toBeNull();
  });

  it('treats an empty-text entry as nothing queued', async () => {
    await putPendingSelection(selection({ text: '' }));
    await expect(takePendingSelection()).resolves.toBeNull();
  });

  it('records that Chrome clipped the text, so the panel can say so', async () => {
    await putPendingSelection(selection({ truncated: true }));
    const taken = await takePendingSelection();
    expect(taken?.truncated).toBe(true);
  });
});
