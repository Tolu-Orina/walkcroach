import { describe, it, expect, vi } from 'vitest';
import { truncate, hashText, extractPage, MAX_EXTRACT_CHARS } from './extract';

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello')).toBe('hello');
  });

  it('caps at MAX_EXTRACT_CHARS with ellipsis', () => {
    const long = 'x'.repeat(MAX_EXTRACT_CHARS + 10);
    const result = truncate(long);
    expect(result.length).toBe(MAX_EXTRACT_CHARS + 1);
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns exact-length strings unchanged', () => {
    const exact = 'a'.repeat(MAX_EXTRACT_CHARS);
    expect(truncate(exact)).toBe(exact);
  });

  it('respects custom max parameter', () => {
    const result = truncate('abcdefghij', 5);
    expect(result).toBe('abcde…');
  });

  it('handles empty string', () => {
    expect(truncate('')).toBe('');
  });
});

describe('hashText', () => {
  it('returns a deterministic fnv hash', async () => {
    const h1 = await hashText('hello');
    const h2 = await hashText('hello');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^fnv:[0-9a-f]+$/);
  });

  it('produces different hashes for different inputs', async () => {
    const h1 = await hashText('foo');
    const h2 = await hashText('bar');
    expect(h1).not.toBe(h2);
  });

  it('handles empty string', async () => {
    const h = await hashText('');
    expect(h).toBe('fnv:0');
  });
});

describe('extractPage', () => {
  function makeDoc(opts: {
    title?: string;
    bodyHtml?: string;
    url?: string;
  }): Document {
    const { title = 'Test Page', bodyHtml = '<p>Content here</p>', url = 'https://example.com/page' } = opts;

    const body = {
      innerText: bodyHtml.replace(/<[^>]*>/g, ''),
      textContent: bodyHtml.replace(/<[^>]*>/g, ''),
    };

    return {
      title,
      location: { href: url },
      cloneNode: vi.fn().mockReturnValue({
        title,
        body,
        documentElement: { innerHTML: bodyHtml },
      }),
      querySelector: vi.fn().mockReturnValue({
        textContent: body.textContent,
      }),
      body,
    } as unknown as Document;
  }

  it('extracts page with fallback when Readability is unavailable or produces short text', async () => {
    const doc = makeDoc({ title: 'My Title', bodyHtml: '<p>Some main content goes here and more text to fill it up nicely</p>' });
    const result = await extractPage(doc);
    expect(result.url).toBe('https://example.com/page');
    expect(result.title).toBe('My Title');
    expect(result.extractedText.length).toBeGreaterThan(0);
    expect(result.contentHash).toMatch(/^fnv:/);
  });

  it('uses document body innerText when main query returns short text', async () => {
    const doc = {
      title: 'T',
      location: { href: 'https://x.com' },
      cloneNode: vi.fn().mockReturnValue({
        title: 'T',
        body: { innerText: '' },
        documentElement: { innerHTML: '' },
      }),
      querySelector: vi.fn().mockReturnValue(null),
      body: {
        innerText: 'This is the fallback body text which is long enough to pass the threshold check here.',
      },
    } as unknown as Document;

    const result = await extractPage(doc);
    expect(result.extractedText).toContain('fallback body text');
  });

  it('truncates very long extracted text', async () => {
    const longText = 'word '.repeat(MAX_EXTRACT_CHARS);
    const doc = makeDoc({ bodyHtml: `<p>${longText}</p>` });
    const result = await extractPage(doc);
    expect(result.extractedText.length).toBeLessThanOrEqual(MAX_EXTRACT_CHARS + 1);
  });
});
