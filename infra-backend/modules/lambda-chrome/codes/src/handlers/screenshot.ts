import { createDbClient } from '@walkcroach/db';
import {
  deleteObject,
  hasBucket,
  ownsKey,
  presignGet,
  presignPut,
  putObject,
  screenshotKey,
} from '@walkcroach/storage';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { metricLog, parseJsonBody } from '../util.js';

/**
 * Screenshot-to-memory (Phase D4).
 *
 * Two upload paths, both ending at the same object key:
 *
 *  - **Presigned PUT** (preferred). The image never touches this Lambda, so a
 *    1MB screenshot costs no invocation time and no API Gateway payload budget.
 *    Requires the bucket to allow the extension origin via CORS — see the
 *    `aws_s3_bucket_cors_configuration` in the Terraform module.
 *  - **Direct POST** (fallback). Used when no bucket is configured (local
 *    development) or when the presigned PUT fails, which it will until bucket
 *    CORS is deployed. Capped hard, because this payload does traverse Lambda.
 *
 * A screenshot is only ever written against a capture the caller already owns,
 * and keys are namespaced per owner so a presigned URL cannot be minted for
 * someone else's object.
 */

/** ~1.3MB of base64 ≈ 1MB of JPEG. Beyond this the client must downscale more. */
export const MAX_DIRECT_UPLOAD_BYTES = 1_400_000;
const CONTENT_TYPE = 'image/jpeg';

async function ownedCapture(
  ownerId: string,
  captureId: string,
): Promise<{ id: string; screenshot_s3_key: string | null } | null> {
  const db = createDbClient();
  try {
    const { rows } = await db.query<{
      id: string;
      screenshot_s3_key: string | null;
    }>(
      `SELECT id, screenshot_s3_key
       FROM page_captures
       WHERE id = $1::uuid AND owner_id = $2 AND superseded_by IS NULL`,
      [captureId, ownerId],
    );
    return rows[0] ?? null;
  } finally {
    await db.close();
  }
}

async function attachKey(
  ownerId: string,
  captureId: string,
  key: string,
): Promise<void> {
  const db = createDbClient();
  try {
    await db.query(
      `UPDATE page_captures
       SET screenshot_s3_key = $3
       WHERE id = $1::uuid AND owner_id = $2`,
      [captureId, ownerId, key],
    );
  } finally {
    await db.close();
  }
}

/**
 * POST /chrome/v1/captures/:id/screenshot/presign
 * Mint a short-lived upload URL, or tell the client to post directly.
 */
export async function handleScreenshotPresign(
  auth: AuthContext,
  captureId: string,
): Promise<ReturnType<typeof jsonResponse>> {
  const capture = await ownedCapture(auth.ownerId, captureId);
  if (!capture) return jsonResponse(404, { error: 'capture not found' });

  const key = screenshotKey(auth.ownerId, captureId);
  const uploadUrl = await presignPut(key, CONTENT_TYPE);

  if (!uploadUrl) {
    // No bucket configured — local dev. The client posts bytes to us instead.
    metricLog('chrome.screenshot.presign', { mode: 'direct' });
    return jsonResponse(200, { mode: 'direct', key, contentType: CONTENT_TYPE });
  }

  metricLog('chrome.screenshot.presign', { mode: 'put' });
  return jsonResponse(200, {
    mode: 'put',
    key,
    uploadUrl,
    contentType: CONTENT_TYPE,
    expiresIn: 300,
  });
}

/**
 * POST /chrome/v1/captures/:id/screenshot
 * Body: { dataBase64 }. Fallback path; also how local dev always works.
 */
export async function handleScreenshotUpload(
  auth: AuthContext,
  captureId: string,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const parsed = parseJsonBody<{ dataBase64?: string }>(rawBody);
  if ('error' in parsed && parsed.error === 'invalid JSON body') {
    return jsonResponse(400, { error: parsed.error });
  }
  const dataBase64 = (parsed as { dataBase64?: string }).dataBase64?.trim();
  if (!dataBase64) return jsonResponse(400, { error: 'dataBase64 required' });
  if (dataBase64.length > MAX_DIRECT_UPLOAD_BYTES) {
    return jsonResponse(413, { error: 'screenshot too large' });
  }

  const capture = await ownedCapture(auth.ownerId, captureId);
  if (!capture) return jsonResponse(404, { error: 'capture not found' });

  let bytes: Buffer;
  try {
    bytes = Buffer.from(dataBase64, 'base64');
  } catch {
    return jsonResponse(400, { error: 'dataBase64 is not valid base64' });
  }
  if (!isJpeg(bytes)) {
    // Never store bytes whose type we have not verified: the content type is
    // echoed back on download, and a mislabelled file is an XSS vector.
    return jsonResponse(400, { error: 'expected a JPEG image' });
  }

  const key = screenshotKey(auth.ownerId, captureId);
  await putObject(key, bytes, CONTENT_TYPE);
  await attachKey(auth.ownerId, captureId, key);

  metricLog('chrome.screenshot.upload', { bytes: bytes.length });
  return jsonResponse(201, { key, bytes: bytes.length });
}

/**
 * POST /chrome/v1/captures/:id/screenshot/commit
 * Record the key after a successful presigned PUT.
 */
export async function handleScreenshotCommit(
  auth: AuthContext,
  captureId: string,
): Promise<ReturnType<typeof jsonResponse>> {
  const capture = await ownedCapture(auth.ownerId, captureId);
  if (!capture) return jsonResponse(404, { error: 'capture not found' });

  const key = screenshotKey(auth.ownerId, captureId);
  await attachKey(auth.ownerId, captureId, key);
  metricLog('chrome.screenshot.commit', { ok: true });
  return jsonResponse(200, { key });
}

/**
 * GET /chrome/v1/captures/:id/screenshot
 * Short-lived read URL. The bucket stays private; nothing is ever public.
 */
export async function handleScreenshotUrl(
  auth: AuthContext,
  captureId: string,
): Promise<ReturnType<typeof jsonResponse>> {
  const capture = await ownedCapture(auth.ownerId, captureId);
  if (!capture?.screenshot_s3_key) {
    return jsonResponse(404, { error: 'no screenshot for this capture' });
  }
  if (!ownsKey(auth.ownerId, capture.screenshot_s3_key)) {
    // A key from another owner's namespace means the row is corrupt or tampered.
    metricLog('chrome.screenshot.key_mismatch', { ok: false });
    return jsonResponse(403, { error: 'forbidden' });
  }

  const url = await presignGet(capture.screenshot_s3_key);
  if (!url) {
    return jsonResponse(503, { error: 'screenshot storage not configured' });
  }
  return jsonResponse(200, { url, expiresIn: 900 });
}

/** Best-effort cleanup when a capture is deleted. */
export async function removeScreenshot(
  ownerId: string,
  key: string | null | undefined,
): Promise<void> {
  if (!key || !ownsKey(ownerId, key)) return;
  try {
    await deleteObject(key);
  } catch {
    // Lifecycle expiry on the bucket is the backstop.
  }
}

/** JPEG SOI marker plus a trailing EOI. Cheap, and enough to reject non-images. */
export function isJpeg(bytes: Buffer): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  );
}

export { hasBucket };
