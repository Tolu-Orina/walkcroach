/**
 * Web search via SearXNG (open-source metasearch).
 * Configure SEARXNG_URL (e.g. https://searx.example/search) with JSON format enabled.
 */

export type WebSearchHit = {
  title: string;
  url: string;
  content: string;
  engine?: string;
};

export type WebSearchResult = {
  query: string;
  hits: WebSearchHit[];
  provider: 'searxng' | 'none';
};

function searxngBase(): string {
  return (process.env.SEARXNG_URL ?? process.env.searxng_url ?? '').replace(
    /\/$/,
    '',
  );
}

export async function webSearch(
  query: string,
  opts?: { limit?: number },
): Promise<WebSearchResult> {
  const base = searxngBase();
  const limit = Math.min(Math.max(opts?.limit ?? 5, 1), 10);
  if (!base) {
    return {
      query,
      provider: 'none',
      hits: [],
    };
  }

  const endpoint = base.includes('?')
    ? `${base}&q=${encodeURIComponent(query)}&format=json`
    : `${base}/search?q=${encodeURIComponent(query)}&format=json`;

  const res = await fetch(endpoint, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`SearXNG HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      engine?: string;
    }>;
  };
  const hits = (data.results ?? [])
    .slice(0, limit)
    .map((r) => ({
      title: r.title ?? r.url ?? 'Untitled',
      url: r.url ?? '',
      content: r.content ?? '',
      engine: r.engine,
    }))
    .filter((h) => h.url);

  return { query, provider: 'searxng', hits };
}

export async function webExtract(url: string): Promise<{
  url: string;
  title: string;
  text: string;
}> {
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'WalkCroachBot/1.0 (+https://walkcroach.rinegansolutions.com)',
    },
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`web_extract HTTP ${res.status} for ${url}`);
  }
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch?.[1]?.trim() ?? url;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12_000);
  return { url, title, text };
}
