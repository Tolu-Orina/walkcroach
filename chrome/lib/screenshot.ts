/**
 * Screenshot capture and upload (Phase D4).
 *
 * `chrome.tabs.captureVisibleTab` returns a PNG data URL of the visible viewport,
 * which on a large monitor is routinely 2–4MB. That is far too large to send
 * anywhere, so it is downscaled and re-encoded as JPEG in the service worker
 * before it goes near the panel or the network.
 *
 * Upload prefers a presigned PUT straight to S3 so image bytes never traverse the
 * Lambda. It falls back to posting through the BFF when no bucket is configured
 * (local development) or when the cross-origin PUT fails — which it will until
 * bucket CORS names the published extension ID. The fallback keeps the feature
 * working rather than failing on an infrastructure detail.
 */

/** Long edge, in CSS pixels. Enough to read a page layout back, not a poster. */
export const MAX_SCREENSHOT_EDGE = 1200;
export const SCREENSHOT_QUALITY = 0.72;
export const SCREENSHOT_MIME = 'image/jpeg';

/** Matches MAX_DIRECT_UPLOAD_BYTES on the BFF. */
export const MAX_UPLOAD_BASE64 = 1_400_000;

export type CapturedScreenshot = {
  /** JPEG data URL, already downscaled. Safe to render as a thumbnail. */
  dataUrl: string;
  width: number;
  height: number;
  /** Length of the base64 payload, which is what the size limit applies to. */
  base64Length: number;
};

/** Target dimensions preserving aspect ratio, never upscaling. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_SCREENSHOT_EDGE,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** `data:image/jpeg;base64,AAA…` → `AAA…`. Returns null if not a data URL. */
export function base64FromDataUrl(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) return null;
  if (!dataUrl.slice(0, comma).includes('base64')) return null;
  const payload = dataUrl.slice(comma + 1);
  return payload.length > 0 ? payload : null;
}

/**
 * Downscale and re-encode in the service worker.
 *
 * Uses `OffscreenCanvas` + `createImageBitmap`, both available in an MV3 worker,
 * so a multi-megabyte PNG is never passed across the message boundary to the
 * panel just to be shrunk there.
 */
export async function downscaleToJpeg(
  pngDataUrl: string,
  maxEdge = MAX_SCREENSHOT_EDGE,
  quality = SCREENSHOT_QUALITY,
): Promise<CapturedScreenshot | null> {
  try {
    const res = await fetch(pngDataUrl);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
    if (!width || !height) {
      bitmap.close();
      return null;
    }

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const out = await canvas.convertToBlob({
      type: SCREENSHOT_MIME,
      quality,
    });
    const dataUrl = await blobToDataUrl(out);
    const base64 = base64FromDataUrl(dataUrl);
    if (!base64) return null;

    return { dataUrl, width, height, base64Length: base64.length };
  } catch {
    return null;
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked: spreading a megabyte into String.fromCharCode overflows the stack.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${SCREENSHOT_MIME};base64,${btoa(binary)}`;
}

export function isWithinUploadLimit(shot: CapturedScreenshot): boolean {
  return shot.base64Length <= MAX_UPLOAD_BASE64;
}
