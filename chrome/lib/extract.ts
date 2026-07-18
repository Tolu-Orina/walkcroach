import { Readability } from '@mozilla/readability';

export const MAX_EXTRACT_CHARS = 24_000;

export type PageExtract = {
  url: string;
  title: string;
  extractedText: string;
  contentHash: string;
};

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Non-crypto fallback for http:// pages where crypto.subtle is unavailable. */
function fallbackHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return `fnv:${hash.toString(16)}`;
}

export async function hashText(text: string): Promise<string> {
  // Prefer a stable sync hash so content-script and background executeScript
  // fallback paths produce the same contentHash (dedupe / cache keys).
  // crypto.subtle SHA-256 is intentionally not used here.
  return fallbackHash(text);
}

export function truncate(text: string, max = MAX_EXTRACT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/**
 * Extract main content. Clones the document because Readability mutates.
 * Must run in a page/document context (content script or executeScript).
 */
export async function extractPage(doc: Document = document): Promise<PageExtract> {
  const url = doc.location?.href ?? location.href;
  let title = doc.title || '';
  let extractedText = '';

  try {
    const clone = doc.cloneNode(true) as Document;
    const article = new Readability(clone, { charThreshold: 100 }).parse();
    if (article?.textContent) {
      title = article.title || title;
      extractedText = normalizeText(article.textContent);
    }
  } catch {
    // fall through
  }

  if (extractedText.length < 40) {
    const main =
      doc.querySelector('main, article, [role="main"]')?.textContent ??
      doc.body?.innerText ??
      '';
    extractedText = normalizeText(main);
  }

  extractedText = truncate(extractedText);
  const contentHash = await hashText(`${url}\n${title}\n${extractedText}`);
  return { url, title, extractedText, contentHash };
}
