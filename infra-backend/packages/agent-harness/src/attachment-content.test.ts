import { describe, expect, it } from 'vitest';
import {
  buildUserContentBlocks,
  titleFromMessage,
} from './attachment-content.js';

describe('titleFromMessage', () => {
  it('uses the message as title when short', () => {
    expect(titleFromMessage('Draft a PTO email')).toBe('Draft a PTO email');
  });

  it('truncates long messages on a word boundary', () => {
    const long =
      'Draft a professional email for my boss requesting paid time off next month for a family event';
    const title = titleFromMessage(long, 40);
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(41);
  });
});

describe('buildUserContentBlocks', () => {
  it('includes text and image blocks', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const blocks = buildUserContentBlocks('Describe this', [
      { name: 'shot.png', mime: 'image/png', bytes },
    ]);
    expect(blocks[0]).toEqual({ text: 'Describe this' });
    expect(blocks[1]).toMatchObject({
      image: { format: 'png', source: { bytes } },
    });
  });

  it('includes PDF document blocks', () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const blocks = buildUserContentBlocks('Summarize', [
      { name: 'report.pdf', mime: 'application/pdf', bytes },
    ]);
    expect(blocks[1]).toMatchObject({
      document: {
        format: 'pdf',
        name: 'report',
        source: { bytes },
      },
    });
  });

  it('inlines text-like attachments without binary', () => {
    const blocks = buildUserContentBlocks('Review', [
      {
        name: 'notes.txt',
        mime: 'text/plain',
        contentText: 'hello world',
      },
    ]);
    expect(blocks.some((b) => 'document' in b && b.document)).toBe(true);
  });
});
