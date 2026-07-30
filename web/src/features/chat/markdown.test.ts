import { describe, expect, it } from 'vitest';
import {
  closeUnclosedFences,
  prepareMarkdown,
  splitIntoBlocks,
} from './markdownPrepare';

describe('prepareMarkdown', () => {
  it('leaves finished markdown alone when not streaming', () => {
    const md = '## Hello\n\n**bold** and `code`';
    expect(prepareMarkdown(md, false)).toBe(md);
  });

  it('closes incomplete bold while streaming', () => {
    expect(prepareMarkdown('Hello **world', true)).toBe('Hello **world**');
  });

  it('closes an open code fence while streaming', () => {
    const md = 'Intro\n\n```ts\nconst x = 1;';
    expect(closeUnclosedFences(md)).toBe(`${md}\n\`\`\``);
    expect(prepareMarkdown(md, true).endsWith('```')).toBe(true);
  });
});

describe('splitIntoBlocks', () => {
  it('splits headings and paragraphs into separate blocks', () => {
    const blocks = splitIntoBlocks('# Title\n\nPara one.\n\nPara two.');
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks[0]).toContain('# Title');
  });

  it('keeps a fenced code block intact', () => {
    const md = 'Before\n\n```js\nconst a = 1;\n```\n\nAfter';
    const blocks = splitIntoBlocks(md);
    const fence = blocks.find((b) => b.includes('```'));
    expect(fence).toBeTruthy();
    expect(fence).toContain('const a = 1;');
  });
});
