import { Lexer } from 'marked';
import remend from 'remend';

/**
 * Close an odd number of ``` / ~~~ fences so mid-stream code still renders.
 * Must run after remend (which is fence-aware) so we don't "complete" syntax
 * that belongs inside an open fence.
 */
export function closeUnclosedFences(text: string): string {
  let open = false;
  for (const line of text.split('\n')) {
    if (/^ {0,3}(`{3,}|~{3,})/.test(line)) open = !open;
  }
  return open ? `${text}\n\`\`\`` : text;
}

/** Self-heal incomplete markdown while tokens are still arriving. */
export function prepareMarkdown(text: string, streaming: boolean): string {
  if (!streaming) return text;
  return closeUnclosedFences(
    remend(text, {
      katex: false,
      inlineKatex: false,
    }),
  );
}

/**
 * Split into top-level blocks via marked's lexer so completed blocks can be
 * memoized while only the tail block re-parses on each token.
 */
export function splitIntoBlocks(markdown: string): string[] {
  if (!markdown) return [];
  try {
    const tokens = Lexer.lex(markdown, { gfm: true });
    const blocks = tokens
      .map((t) => ('raw' in t && typeof t.raw === 'string' ? t.raw : ''))
      .filter((raw) => raw.length > 0);
    return blocks.length > 0 ? blocks : [markdown];
  } catch {
    return [markdown];
  }
}
