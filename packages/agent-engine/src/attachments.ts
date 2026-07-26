/**
 * Chat attachments (paste / attach: images, PDFs, Office docs, text/code files)
 * → Bedrock Converse API content blocks.
 *
 * Reimplements infra-backend/packages/agent-harness/src/attachment-content.ts's
 * logic (the Web app builder's proven pattern) rather than importing it — that
 * file lives in a separate deployable and agent-engine must stay standalone.
 * Same constants/format-mapping as the Web app for consistency across surfaces.
 */

import type {
  ContentBlock,
  DocumentFormat,
  ImageFormat,
  Message,
} from '@aws-sdk/client-bedrock-runtime';
import type { SubmitAttachment } from './protocol.js';

/** Per-attachment cap (raw bytes, before base64 inflation). */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
/** Bedrock caps images and documents at 5 each per request; one combined cap keeps this simple. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

const IMAGE_FORMATS: Record<string, ImageFormat> = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  gif: 'gif',
  webp: 'webp',
};

const DOCUMENT_FORMATS: Record<string, DocumentFormat> = {
  pdf: 'pdf',
  csv: 'csv',
  doc: 'doc',
  docx: 'docx',
  xls: 'xls',
  xlsx: 'xlsx',
  html: 'html',
  htm: 'html',
  txt: 'txt',
  md: 'md',
};

function extOf(name: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name);
  return m ? m[1]!.toLowerCase() : '';
}

function imageFormatFor(mime: string, name: string): ImageFormat | undefined {
  const mimeSub = mime.startsWith('image/') ? mime.slice('image/'.length).toLowerCase() : '';
  return IMAGE_FORMATS[mimeSub] ?? IMAGE_FORMATS[extOf(name)];
}

function documentFormatFor(mime: string, name: string): DocumentFormat | undefined {
  if (mime === 'application/pdf') return 'pdf';
  return DOCUMENT_FORMATS[extOf(name)];
}

/** Bedrock requires document.name to match [A-Za-z0-9\s\-()[\]]+. */
export function sanitizeDocumentName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  const cleaned = base.replace(/[^A-Za-z0-9\s\-()[\]]+/g, ' ').trim();
  return (cleaned || 'document').slice(0, 200);
}

function decodeBase64(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

function approxByteLength(a: SubmitAttachment): number {
  if (a.contentBase64) return Math.floor((a.contentBase64.length * 3) / 4);
  if (a.contentText) return Buffer.byteLength(a.contentText, 'utf8');
  return 0;
}

/**
 * Maps attachments to Bedrock content blocks: images → `image`, recognized
 * document formats → `document` (bytes from contentBase64, or UTF-8-encoded
 * contentText as fallback), other text-like files → inlined `text`. Oversized,
 * over-the-cap, or unclassifiable entries are dropped with a trailing note —
 * defense in depth; the webview already validates before send.
 */
export function attachmentsToContentBlocks(
  attachments: SubmitAttachment[] = [],
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const notes: string[] = [];
  let count = 0;

  for (const a of attachments) {
    if (count >= MAX_ATTACHMENTS_PER_MESSAGE) {
      notes.push(
        `"${a.name}" skipped: at most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message.`,
      );
      continue;
    }
    if (approxByteLength(a) > MAX_ATTACHMENT_BYTES) {
      notes.push(
        `"${a.name}" skipped: larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`,
      );
      continue;
    }

    const imageFormat = imageFormatFor(a.mime, a.name);
    if (imageFormat && a.contentBase64) {
      blocks.push({
        image: { format: imageFormat, source: { bytes: decodeBase64(a.contentBase64) } },
      });
      count += 1;
      continue;
    }

    const docFormat = documentFormatFor(a.mime, a.name);
    if (docFormat) {
      const bytes = a.contentBase64
        ? decodeBase64(a.contentBase64)
        : a.contentText
          ? new TextEncoder().encode(a.contentText)
          : undefined;
      if (bytes?.length) {
        blocks.push({
          document: {
            format: docFormat,
            name: sanitizeDocumentName(a.name),
            source: { bytes },
          },
        });
        count += 1;
        continue;
      }
    }

    if (a.contentText?.trim()) {
      blocks.push({
        text: `\n--- Attached: ${a.name} ---\n${a.contentText.slice(0, 100_000)}`,
      });
      count += 1;
      continue;
    }

    notes.push(`"${a.name}" skipped: unsupported file type.`);
  }

  if (notes.length) {
    blocks.push({ text: `\n(Note: ${notes.join(' ')})` });
  }

  return blocks;
}

function isAttachmentBlock(block: unknown): block is ContentBlock {
  return Boolean(
    block &&
      typeof block === 'object' &&
      ('image' in block || 'document' in block),
  );
}

/**
 * Strips image/document content blocks from message history before it's
 * persisted or reused as `priorMessages` — every subsequent Converse call
 * resends the full history, so keeping raw attachment bytes there would
 * eventually exceed Bedrock's 25MB payload cap on any session with a few
 * attachments. Attachments are real content only for the turn they arrived
 * in. Non-mutating.
 */
export function redactAttachmentBlocks(messages: Message[]): Message[] {
  return messages.map((m) => {
    if (!m.content?.some(isAttachmentBlock)) return m;
    const content = m.content.map((b) => {
      if (b && typeof b === 'object' && 'image' in b) {
        return { text: '[attachment: image — not retained in session history]' };
      }
      if (b && typeof b === 'object' && 'document' in b) {
        const name = (b as { document?: { name?: string } }).document?.name;
        return {
          text: `[attachment: ${name ?? 'document'} — not retained in session history]`,
        };
      }
      return b;
    });
    return { ...m, content };
  });
}
