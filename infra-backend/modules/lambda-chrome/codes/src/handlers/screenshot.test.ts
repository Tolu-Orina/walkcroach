import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthContext } from '../auth.js';

/**
 * Screenshot-to-memory guards (Phase D4).
 *
 * The properties that matter here are ownership — a presigned URL must never be
 * mintable for another owner's object — and content validation, because the
 * stored bytes are served back to a browser later.
 */

type QueryResult = { rows: unknown[] };
const queue: QueryResult[] = [];
const queries: Array<{ sql: string; params: unknown[] }> = [];
const stored: Array<{ key: string; bytes: number; contentType: string }> = [];
const presigned: string[] = [];
let bucket: string | null = 'test-bucket';

vi.mock('@walkcroach/db', () => ({
  createDbClient: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return queue.shift() ?? { rows: [] };
    },
    close: async () => {},
  }),
}));

vi.mock('@walkcroach/storage', async () => {
  const actual = await vi.importActual<typeof import('@walkcroach/storage')>(
    '@walkcroach/storage',
  );
  return {
    ...actual,
    hasBucket: () => bucket !== null,
    putObject: async (key: string, bodyBytes: Buffer, contentType: string) => {
      stored.push({ key, bytes: bodyBytes.length, contentType });
    },
    deleteObject: async () => {},
    presignPut: async (key: string) => {
      if (!bucket) return null;
      presigned.push(key);
      return `https://${bucket}.s3.test/${key}?sig=x`;
    },
    presignGet: async (key: string) =>
      bucket ? `https://${bucket}.s3.test/${key}?get=x` : null,
  };
});

const {
  handleScreenshotPresign,
  handleScreenshotUpload,
  handleScreenshotUrl,
  isJpeg,
  MAX_DIRECT_UPLOAD_BYTES,
} = await import('./screenshot.js');
const { screenshotKey, ownsKey } = await import('@walkcroach/storage');

const auth: AuthContext = {
  ownerId: 'cognito-sub-1',
  isAnonymous: false,
  source: 'jwt',
};
const CAPTURE = '11111111-1111-4111-8111-111111111111';

/** Minimal well-formed JPEG: SOI then EOI. */
function jpeg(padding = 8): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.alloc(padding, 0x20),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function body(res: { body: string }): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>;
}

beforeEach(() => {
  queue.length = 0;
  queries.length = 0;
  stored.length = 0;
  presigned.length = 0;
  bucket = 'test-bucket';
});

describe('isJpeg', () => {
  it('accepts a JPEG', () => {
    expect(isJpeg(jpeg())).toBe(true);
  });

  it('rejects PNG, HTML, and truncated data', () => {
    // Stored bytes are served back later, so a mislabelled file is an XSS vector.
    expect(isJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe(false);
    expect(isJpeg(Buffer.from('<script>alert(1)</script>'))).toBe(false);
    expect(isJpeg(Buffer.from([0xff, 0xd8]))).toBe(false);
    expect(isJpeg(Buffer.alloc(0))).toBe(false);
  });
});

describe('key namespacing', () => {
  it('scopes keys under the owner', () => {
    const key = screenshotKey(auth.ownerId, CAPTURE);
    expect(key.startsWith('chrome/cognito-sub-1/')).toBe(true);
    expect(ownsKey(auth.ownerId, key)).toBe(true);
  });

  it('refuses another account key, and path traversal', () => {
    const mine = screenshotKey(auth.ownerId, CAPTURE);
    expect(ownsKey('someone-else', mine)).toBe(false);
    expect(ownsKey(auth.ownerId, 'chrome/cognito-sub-1/../other/x.jpg')).toBe(
      false,
    );
  });
});

describe('presign', () => {
  it('404s a capture the caller does not own', async () => {
    queue.push({ rows: [] });
    const res = await handleScreenshotPresign(auth, CAPTURE);
    expect(res.statusCode).toBe(404);
    // Ownership is enforced in SQL, and no URL is minted.
    expect(queries[0]!.sql).toMatch(/owner_id = \$2/);
    expect(presigned).toHaveLength(0);
  });

  it('mints a PUT url for an owned capture', async () => {
    queue.push({ rows: [{ id: CAPTURE, screenshot_s3_key: null }] });
    const res = await handleScreenshotPresign(auth, CAPTURE);
    expect(res.statusCode).toBe(200);
    expect(body(res).mode).toBe('put');
    expect(String(body(res).uploadUrl)).toContain('s3.test');
    expect(body(res).contentType).toBe('image/jpeg');
  });

  it('falls back to direct mode with no bucket, so local dev works', async () => {
    bucket = null;
    queue.push({ rows: [{ id: CAPTURE, screenshot_s3_key: null }] });
    const res = await handleScreenshotPresign(auth, CAPTURE);
    expect(body(res).mode).toBe('direct');
    expect(body(res).uploadUrl).toBeUndefined();
  });
});

describe('direct upload', () => {
  it('stores a valid JPEG and records the key', async () => {
    queue.push({ rows: [{ id: CAPTURE, screenshot_s3_key: null }] });
    const res = await handleScreenshotUpload(
      auth,
      CAPTURE,
      JSON.stringify({ dataBase64: jpeg(64).toString('base64') }),
    );
    expect(res.statusCode).toBe(201);
    expect(stored[0]!.contentType).toBe('image/jpeg');
    expect(stored[0]!.key).toBe(screenshotKey(auth.ownerId, CAPTURE));
    expect(queries.some((q) => /SET screenshot_s3_key/.test(q.sql))).toBe(true);
  });

  it('rejects bytes that are not a JPEG', async () => {
    queue.push({ rows: [{ id: CAPTURE, screenshot_s3_key: null }] });
    const res = await handleScreenshotUpload(
      auth,
      CAPTURE,
      JSON.stringify({ dataBase64: Buffer.from('<html>').toString('base64') }),
    );
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toMatch(/JPEG/);
    expect(stored).toHaveLength(0);
  });

  it('rejects an oversized payload before touching the database', async () => {
    const res = await handleScreenshotUpload(
      auth,
      CAPTURE,
      JSON.stringify({ dataBase64: 'A'.repeat(MAX_DIRECT_UPLOAD_BYTES + 1) }),
    );
    expect(res.statusCode).toBe(413);
    expect(queries).toHaveLength(0);
  });

  it('requires a payload', async () => {
    const res = await handleScreenshotUpload(auth, CAPTURE, '{}');
    expect(res.statusCode).toBe(400);
    expect(queries).toHaveLength(0);
  });

  it('rejects a malformed body', async () => {
    const res = await handleScreenshotUpload(auth, CAPTURE, '{ nope');
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toBe('invalid JSON body');
  });

  it('will not store against a capture the caller does not own', async () => {
    queue.push({ rows: [] });
    const res = await handleScreenshotUpload(
      auth,
      CAPTURE,
      JSON.stringify({ dataBase64: jpeg().toString('base64') }),
    );
    expect(res.statusCode).toBe(404);
    expect(stored).toHaveLength(0);
  });
});

describe('read url', () => {
  it('404s when the capture has no screenshot', async () => {
    queue.push({ rows: [{ id: CAPTURE, screenshot_s3_key: null }] });
    const res = await handleScreenshotUrl(auth, CAPTURE);
    expect(res.statusCode).toBe(404);
  });

  it('mints a short-lived GET url', async () => {
    queue.push({
      rows: [
        { id: CAPTURE, screenshot_s3_key: screenshotKey(auth.ownerId, CAPTURE) },
      ],
    });
    const res = await handleScreenshotUrl(auth, CAPTURE);
    expect(res.statusCode).toBe(200);
    expect(body(res).expiresIn).toBe(900);
    expect(String(body(res).url)).toContain('get=x');
  });

  it('refuses a stored key from another account namespace', async () => {
    // Corrupt or tampered row: never sign a read for it.
    queue.push({
      rows: [{ id: CAPTURE, screenshot_s3_key: 'chrome/someone-else/x.jpg' }],
    });
    const res = await handleScreenshotUrl(auth, CAPTURE);
    expect(res.statusCode).toBe(403);
  });

  it('503s rather than returning a broken url when storage is unconfigured', async () => {
    bucket = null;
    queue.push({
      rows: [
        { id: CAPTURE, screenshot_s3_key: screenshotKey(auth.ownerId, CAPTURE) },
      ],
    });
    const res = await handleScreenshotUrl(auth, CAPTURE);
    expect(res.statusCode).toBe(503);
  });
});
