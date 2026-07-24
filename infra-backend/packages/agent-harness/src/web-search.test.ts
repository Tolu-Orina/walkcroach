import { describe, expect, it, vi } from 'vitest';
import { webSearch } from './web-search.js';

describe('webSearch', () => {
  it('returns provider none when SEARXNG_URL unset', async () => {
    const prev = process.env.SEARXNG_URL;
    delete process.env.SEARXNG_URL;
    delete process.env.searxng_url;
    const result = await webSearch('test');
    expect(result.provider).toBe('none');
    expect(result.hits).toEqual([]);
    if (prev) process.env.SEARXNG_URL = prev;
  });

  it('parses SearXNG JSON results', async () => {
    process.env.SEARXNG_URL = 'https://searx.example';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'Example',
            url: 'https://example.com',
            content: 'Hello',
            engine: 'google',
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await webSearch('hello', { limit: 3 });
    expect(result.provider).toBe('searxng');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.url).toBe('https://example.com');
    expect(fetchMock).toHaveBeenCalled();

    vi.unstubAllGlobals();
    delete process.env.SEARXNG_URL;
  });
});
