/**
 * Map chat attachments to Bedrock Converse ContentBlocks (images + documents).
 * @see https://docs.aws.amazon.com/nova/latest/nova2-userguide/using-multimodal-models.html
 */
import type { ContentBlock } from '@aws-sdk/client-bedrock-runtime';

export type AttachmentBytes = {
  name: string;
  mime: string;
  /** UTF-8 text body when available */
  contentText?: string;
  /** Raw bytes for images / binary documents */
  bytes?: Uint8Array;
};

const IMAGE_FORMATS = new Set(['png', 'jpeg', 'jpg', 'gif', 'webp']);

const DOCUMENT_FORMATS = new Set([
  'pdf',
  'csv',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'html',
  'txt',
  'md',
]);

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function mimeToImageFormat(
  mime: string,
  ext: string,
): 'png' | 'jpeg' | 'gif' | 'webp' | null {
  const m = mime.toLowerCase();
  if (m === 'image/png' || ext === 'png') return 'png';
  if (m === 'image/jpeg' || m === 'image/jpg' || ext === 'jpg' || ext === 'jpeg')
    return 'jpeg';
  if (m === 'image/gif' || ext === 'gif') return 'gif';
  if (m === 'image/webp' || ext === 'webp') return 'webp';
  if (IMAGE_FORMATS.has(ext) && ext !== 'jpg') {
    return ext as 'png' | 'jpeg' | 'gif' | 'webp';
  }
  if (ext === 'jpg') return 'jpeg';
  return null;
}

function mimeToDocumentFormat(
  mime: string,
  ext: string,
):
  | 'pdf'
  | 'csv'
  | 'doc'
  | 'docx'
  | 'xls'
  | 'xlsx'
  | 'html'
  | 'txt'
  | 'md'
  | null {
  const m = mime.toLowerCase();
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (m === 'text/csv' || ext === 'csv') return 'csv';
  if (m === 'application/msword' || ext === 'doc') return 'doc';
  if (
    m ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  )
    return 'docx';
  if (m === 'application/vnd.ms-excel' || ext === 'xls') return 'xls';
  if (
    m ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    ext === 'xlsx'
  )
    return 'xlsx';
  if (m === 'text/html' || ext === 'html' || ext === 'htm') return 'html';
  if (m === 'text/markdown' || ext === 'md' || ext === 'markdown') return 'md';
  if (m === 'text/plain' || ext === 'txt') return 'txt';
  if (DOCUMENT_FORMATS.has(ext)) {
    return ext as
      | 'pdf'
      | 'csv'
      | 'doc'
      | 'docx'
      | 'xls'
      | 'xlsx'
      | 'html'
      | 'txt'
      | 'md';
  }
  return null;
}

/** Bedrock document.name: letters, digits, spaces, hyphens, parentheses, brackets. */
function sanitizeDocumentName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  const cleaned = base.replace(/[^A-Za-z0-9\s\-()[\]]+/g, ' ').trim();
  return (cleaned || 'document').slice(0, 200);
}

/**
 * Build Converse content blocks for a user turn: text first, then media.
 * Unsupported binaries are skipped (caller should still mention them in text if needed).
 */
export function buildUserContentBlocks(
  message: string,
  attachments: AttachmentBytes[] = [],
): ContentBlock[] {
  const blocks: ContentBlock[] = [{ text: message }];
  let docCount = 0;
  let imageCount = 0;

  for (const a of attachments.slice(0, 5)) {
    const ext = extOf(a.name);
    const imageFormat = mimeToImageFormat(a.mime, ext);
    const docFormat = mimeToDocumentFormat(a.mime, ext);

    if (imageFormat && a.bytes?.length && imageCount < 5) {
      blocks.push({
        image: {
          format: imageFormat,
          source: { bytes: a.bytes },
        },
      });
      imageCount += 1;
      continue;
    }

    if (docFormat && docCount < 5) {
      let bytes = a.bytes;
      if (!bytes?.length && typeof a.contentText === 'string') {
        bytes = new TextEncoder().encode(a.contentText);
      }
      if (!bytes?.length) continue;
      blocks.push({
        document: {
          format: docFormat,
          name: sanitizeDocumentName(a.name),
          source: { bytes },
        },
      });
      docCount += 1;
      continue;
    }

    // Plain text-like files without a document format — inline as extra text
    if (typeof a.contentText === 'string' && a.contentText.trim()) {
      blocks.push({
        text: `\n--- Attached: ${a.name} ---\n${a.contentText.slice(0, 100_000)}`,
      });
    }
  }

  return blocks;
}

export function titleFromMessage(message: string, maxLen = 56): string {
  const cleaned = message
    .replace(/\s+/g, ' ')
    .replace(/^\[System:[^\]]*\]\s*/gi, '')
    .trim();
  if (!cleaned) return 'New chat';
  if (cleaned.length <= maxLen) return cleaned;
  const cut = cleaned.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}
