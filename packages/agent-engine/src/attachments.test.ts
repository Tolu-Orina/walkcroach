import { describe, expect, it } from 'vitest';
import type { Message } from '@aws-sdk/client-bedrock-runtime';
import type { SubmitAttachment } from './protocol.js';
import {
  attachmentsToContentBlocks,
  redactAttachmentBlocks,
  sanitizeDocumentName,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from './attachments.js';

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

function att(overrides: Partial<SubmitAttachment>): SubmitAttachment {
  return { id: 'a1', name: 'file.bin', mime: 'application/octet-stream', ...overrides };
}

describe('attachmentsToContentBlocks — images', () => {
  it('maps recognized image mimes to image blocks', () => {
    const blocks = attachmentsToContentBlocks([
      att({ name: 'photo.png', mime: 'image/png', contentBase64: b64('png-bytes') }),
    ]);
    expect(blocks).toEqual([
      { image: { format: 'png', source: { bytes: expect.any(Uint8Array) } } },
    ]);
  });

  it('maps image/jpg to jpeg (Bedrock has no "jpg" ImageFormat)', () => {
    const blocks = attachmentsToContentBlocks([
      att({ name: 'photo.jpg', mime: 'image/jpg', contentBase64: b64('x') }),
    ]);
    expect(blocks).toEqual([
      { image: { format: 'jpeg', source: { bytes: expect.any(Uint8Array) } } },
    ]);
  });

  it('falls back to file extension when mime is generic/missing', () => {
    const blocks = attachmentsToContentBlocks([
      att({ name: 'screenshot.webp', mime: 'application/octet-stream', contentBase64: b64('x') }),
    ]);
    expect(blocks).toEqual([
      { image: { format: 'webp', source: { bytes: expect.any(Uint8Array) } } },
    ]);
  });

  it('decodes contentBase64 to the original bytes', () => {
    const blocks = attachmentsToContentBlocks([
      att({ name: 'a.gif', mime: 'image/gif', contentBase64: b64('hello') }),
    ]);
    const source = (blocks[0] as { image: { source: { bytes: Uint8Array } } }).image.source;
    expect(Buffer.from(source.bytes).toString('utf8')).toBe('hello');
  });
});

describe('attachmentsToContentBlocks — documents', () => {
  it('maps recognized document formats, sanitizing the name', () => {
    const blocks = attachmentsToContentBlocks([
      att({ name: 'Q3 Report (final).pdf', mime: 'application/pdf', contentBase64: b64('%PDF-1.4') }),
    ]);
    expect(blocks).toEqual([
      {
        document: {
          format: 'pdf',
          name: 'Q3 Report (final)',
          source: { bytes: expect.any(Uint8Array) },
        },
      },
    ]);
  });

  it('maps csv/doc/docx/xls/xlsx/html/htm/txt/md by extension', () => {
    const cases: Array<[string, string]> = [
      ['a.csv', 'csv'],
      ['a.doc', 'doc'],
      ['a.docx', 'docx'],
      ['a.xls', 'xls'],
      ['a.xlsx', 'xlsx'],
      ['a.html', 'html'],
      ['a.htm', 'html'],
      ['a.txt', 'txt'],
      ['a.md', 'md'],
    ];
    for (const [name, format] of cases) {
      const blocks = attachmentsToContentBlocks([
        att({ name, mime: 'application/octet-stream', contentBase64: b64('x') }),
      ]);
      expect(blocks[0]).toMatchObject({ document: { format } });
    }
  });

  it('UTF-8-encodes contentText when no contentBase64 is present', () => {
    const blocks = attachmentsToContentBlocks([
      att({ name: 'notes.txt', mime: 'text/plain', contentText: 'hello world' }),
    ]);
    const source = (blocks[0] as { document: { source: { bytes: Uint8Array } } }).document
      .source;
    expect(Buffer.from(source.bytes).toString('utf8')).toBe('hello world');
  });
});

describe('attachmentsToContentBlocks — text fallback and unsupported', () => {
  it('inlines a non-document text-like file (e.g. .ts) as a text block', () => {
    const blocks = attachmentsToContentBlocks([
      att({ name: 'index.ts', mime: 'text/plain', contentText: 'export const x = 1;' }),
    ]);
    expect(blocks).toHaveLength(1);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('index.ts');
    expect(text).toContain('export const x = 1;');
  });

  it('drops an attachment with no recognizable format and no text, noting it', () => {
    const blocks = attachmentsToContentBlocks([att({ name: 'archive.zip', mime: 'application/zip' })]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ text: expect.stringContaining('archive.zip') });
    expect(blocks[0]).toEqual({ text: expect.stringContaining('unsupported file type') });
  });

  it('returns an empty array for no attachments', () => {
    expect(attachmentsToContentBlocks([])).toEqual([]);
    expect(attachmentsToContentBlocks(undefined)).toEqual([]);
  });
});

describe('attachmentsToContentBlocks — caps', () => {
  it('skips an attachment larger than MAX_ATTACHMENT_BYTES', () => {
    const huge = 'x'.repeat(MAX_ATTACHMENT_BYTES + 1);
    const blocks = attachmentsToContentBlocks([
      att({ name: 'big.txt', mime: 'text/plain', contentText: huge }),
    ]);
    expect(blocks).toEqual([{ text: expect.stringContaining('larger than') }]);
  });

  it('only keeps the first MAX_ATTACHMENTS_PER_MESSAGE attachments', () => {
    const many = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 2 }, (_, i) =>
      att({ id: `a${i}`, name: `n${i}.txt`, mime: 'text/plain', contentText: `body ${i}` }),
    );
    const blocks = attachmentsToContentBlocks(many);
    // MAX_ATTACHMENTS_PER_MESSAGE real blocks + 1 trailing note block.
    expect(blocks).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE + 1);
    expect(blocks[blocks.length - 1]).toEqual({
      text: expect.stringContaining('at most'),
    });
  });
});

describe('sanitizeDocumentName', () => {
  it('strips the extension and disallowed characters', () => {
    expect(sanitizeDocumentName('Q3 Report (final)/v2.pdf')).toBe('Q3 Report (final) v2');
  });

  it('falls back to "document" when nothing valid remains', () => {
    expect(sanitizeDocumentName('.pdf')).toBe('document');
    expect(sanitizeDocumentName('###.txt')).toBe('document');
  });

  it('caps length at 200 chars', () => {
    const long = 'a'.repeat(500) + '.pdf';
    expect(sanitizeDocumentName(long).length).toBe(200);
  });
});

describe('redactAttachmentBlocks', () => {
  it('replaces image and document blocks with placeholders, leaves text alone', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { text: 'here is a file' },
          { image: { format: 'png', source: { bytes: new Uint8Array([1, 2, 3]) } } },
          {
            document: {
              format: 'pdf',
              name: 'Report',
              source: { bytes: new Uint8Array([4, 5, 6]) },
            },
          },
        ],
      },
      { role: 'assistant', content: [{ text: 'got it' }] },
    ];

    const redacted = redactAttachmentBlocks(messages);
    expect(redacted[0]!.content).toEqual([
      { text: 'here is a file' },
      { text: '[attachment: image — not retained in session history]' },
      { text: '[attachment: Report — not retained in session history]' },
    ]);
    expect(redacted[1]).toEqual(messages[1]);
  });

  it('does not mutate the original messages', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [{ image: { format: 'png', source: { bytes: new Uint8Array([1]) } } }],
      },
    ];
    const original = JSON.stringify(messages);
    redactAttachmentBlocks(messages);
    expect(JSON.stringify(messages)).toBe(original);
  });

  it('passes through messages with no attachment blocks unchanged', () => {
    const messages: Message[] = [{ role: 'user', content: [{ text: 'plain message' }] }];
    expect(redactAttachmentBlocks(messages)).toEqual(messages);
  });
});
