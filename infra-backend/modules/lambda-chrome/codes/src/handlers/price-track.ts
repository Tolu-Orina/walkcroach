import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { embedText, formatVector } from './llm.js';
import { metricLog, parseJsonBody, truncateExtract } from '../util.js';
import {
  getLinkedProjectId,
  mirrorCaptureToProjectMemory,
  updateMirroredCaptureMemory,
} from './link.js';

export type PricePoint = { price: number; currency: string; at: string };

type PriceFields = {
  price: number;
  currency: string;
  productName?: string;
  history: PricePoint[];
};

/** Oldest points are dropped past this. */
export const MAX_HISTORY_POINTS = 100;

/**
 * Append a check to price history only when it says something new (Phase D2).
 *
 * Previously every visit appended unconditionally, so re-opening a product page
 * five times wrote five identical points. That flattened the sparkline into a
 * meaningless straight line, made "12 checks" a measure of browsing rather than
 * of price movement, and burned the 100-point cap with duplicates so genuine
 * older movement was evicted.
 *
 * An unchanged price still matters — it is evidence the price held — so the last
 * point's timestamp moves forward instead. Currency changes always append: the
 * same number in a different currency is a different price.
 */
export function nextPriceHistory(
  previous: PricePoint[] | undefined,
  point: PricePoint,
): { history: PricePoint[]; changed: boolean } {
  const history = Array.isArray(previous) ? [...previous] : [];
  const last = history[history.length - 1];

  if (last && last.price === point.price && last.currency === point.currency) {
    history[history.length - 1] = { ...last, at: point.at };
    return { history, changed: false };
  }

  history.push(point);
  while (history.length > MAX_HISTORY_POINTS) history.shift();
  return { history, changed: true };
}

/**
 * FR-C13: upsert price track by workspace + url.
 * Repeat visits append history instead of duplicating.
 */
export async function handlePriceTrack(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const body = parseJsonBody<{
    workspaceId?: string;
    url?: string;
    title?: string;
    extractedText?: string;
    contentHash?: string;
    price?: number | string;
    currency?: string;
    productName?: string;
    structuredFields?: Record<string, unknown>;
  }>(rawBody);
  if ('error' in body && body.error === 'invalid JSON body') {
    return jsonResponse(400, { error: body.error });
  }
  const b = body as {
    workspaceId?: string;
    url?: string;
    title?: string;
    extractedText?: string;
    contentHash?: string;
    price?: number | string;
    currency?: string;
    productName?: string;
    structuredFields?: Record<string, unknown>;
  };

  if (!b.workspaceId) return jsonResponse(400, { error: 'workspaceId required' });
  if (!b.url?.trim()) return jsonResponse(400, { error: 'url required' });

  const priceNum = coercePrice(
    b.price ?? b.structuredFields?.price ?? extractPriceFromText(b.extractedText),
  );
  if (priceNum == null) {
    return jsonResponse(400, { error: 'price required or could not be parsed' });
  }
  const currency = String(
    b.currency ?? b.structuredFields?.currency ?? 'USD',
  ).toUpperCase();
  const productName = String(
    b.productName ?? b.structuredFields?.productName ?? b.title ?? '',
  );
  const now = new Date().toISOString();
  const extracted = truncateExtract(b.extractedText ?? '');

  const db = createDbClient();
  try {
    const owned = await db.query(
      `SELECT 1 FROM workspaces WHERE id = $1::uuid AND owner_id = $2`,
      [b.workspaceId, auth.ownerId],
    );
    if (!owned.rows[0]) {
      return jsonResponse(404, { error: 'workspace not found' });
    }

    const linkedProjectId = await getLinkedProjectId(
      db,
      b.workspaceId,
      auth.ownerId,
    );

    const existing = await db.query<{
      id: string;
      structured_fields: PriceFields | Record<string, unknown>;
      extracted_text: string | null;
    }>(
      `SELECT id, structured_fields, extracted_text
       FROM page_captures
       WHERE workspace_id = $1::uuid
         AND owner_id = $2
         AND url = $3
         AND capture_type = 'price'
         AND superseded_by IS NULL
       ORDER BY captured_at DESC
       LIMIT 1`,
      [b.workspaceId, auth.ownerId, b.url.trim()],
    );

    if (existing.rows[0]) {
      const row = existing.rows[0];
      const prev = (row.structured_fields ?? {}) as Partial<PriceFields>;
      const { history, changed } = nextPriceHistory(prev.history, {
        price: priceNum,
        currency,
        at: now,
      });
      const fields: PriceFields = {
        price: priceNum,
        currency,
        productName: productName || prev.productName,
        history,
      };
      const summaryText = [
        productName || b.title || 'Product',
        `Current price: ${currency} ${priceNum}`,
        `History points: ${history.length}`,
        extracted.slice(0, 2000),
      ].join('\n');
      const embedding = await embedText(summaryText.slice(0, 8000));
      const vec = formatVector(embedding);
      await db.query(
        `UPDATE page_captures
         SET title = COALESCE($3, title),
             extracted_text = $4,
             structured_fields = $5::jsonb,
             embedding = $6::vector,
             content_hash = COALESCE($7, content_hash),
             project_id = COALESCE($8::uuid, project_id),
             captured_at = now()
         WHERE id = $1::uuid AND owner_id = $2`,
        [
          row.id,
          auth.ownerId,
          b.title?.trim() || null,
          summaryText,
          JSON.stringify(fields),
          vec,
          b.contentHash ?? null,
          linkedProjectId,
        ],
      );
      if (linkedProjectId) {
        await updateMirroredCaptureMemory({
          db,
          projectId: linkedProjectId,
          captureId: row.id,
          url: b.url.trim(),
          title: b.title?.trim() || productName || null,
          extractedText: summaryText,
          embedding: vec,
          captureType: 'price',
          actorOwnerId: auth.ownerId,
        });
      }
      metricLog('chrome.capture.price_append', {
        historyLen: history.length,
        changed,
        linked: Boolean(linkedProjectId),
      });
      return jsonResponse(200, {
        captureId: row.id,
        appended: true,
        /** False when the price was identical to the previous check. */
        priceChanged: changed,
        structuredFields: fields,
        linkedProjectId,
        availableInWebProject: Boolean(linkedProjectId),
      });
    }

    const fields: PriceFields = {
      price: priceNum,
      currency,
      productName,
      history: [{ price: priceNum, currency, at: now }],
    };
    const summaryText = [
      productName || b.title || 'Product',
      `Current price: ${currency} ${priceNum}`,
      extracted.slice(0, 2000),
    ].join('\n');
    const embedding = await embedText(summaryText.slice(0, 8000));
    const vec = formatVector(embedding);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO page_captures (
         workspace_id, owner_id, project_id, url, title, extracted_text,
         embedding, capture_type, structured_fields, content_hash
       ) VALUES (
         $1::uuid, $2, $3::uuid, $4, $5, $6, $7::vector, 'price', $8::jsonb, $9
       )
       RETURNING id`,
      [
        b.workspaceId,
        auth.ownerId,
        linkedProjectId,
        b.url.trim(),
        b.title?.trim() || productName || null,
        summaryText,
        vec,
        JSON.stringify(fields),
        b.contentHash ?? null,
      ],
    );
    await db.query(
      `UPDATE workspaces SET updated_at = now() WHERE id = $1::uuid`,
      [b.workspaceId],
    );
    if (linkedProjectId) {
      await mirrorCaptureToProjectMemory({
        db,
        projectId: linkedProjectId,
        captureId: rows[0]!.id,
        url: b.url.trim(),
        title: b.title?.trim() || productName || null,
        extractedText: summaryText,
        embedding: vec,
        captureType: 'price',
      });
    }
    metricLog('chrome.capture.save', {
      captureType: 'price',
      linked: Boolean(linkedProjectId),
    });
    return jsonResponse(201, {
      captureId: rows[0]!.id,
      appended: false,
      structuredFields: fields,
      linkedProjectId,
      availableInWebProject: Boolean(linkedProjectId),
    });
  } finally {
    await db.close();
  }
}

/**
 * Parse a price string into a number, honouring both decimal conventions.
 *
 * Stripping all commas — the previous behaviour — turns the European "45,50"
 * into 4550, a hundredfold error recorded as a real price and plotted on the
 * user's history. Which separator is decimal is decided by position, the same
 * way a person reads it:
 *
 *   "1,299.00" → both present, dot is last  → dot is decimal   → 1299.00
 *   "1.299,00" → both present, comma last   → comma is decimal → 1299.00
 *   "45,50"    → comma with exactly 2 after → decimal          → 45.50
 *   "1,299"    → comma with 3 after         → thousands        → 1299
 *
 * "1.299" stays 1.299: a lone dot is read as decimal, because our target markets
 * write it that way and a bare three-digit group is genuinely ambiguous.
 */
export function coercePrice(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;

  const digits = raw.replace(/[^0-9.,]/g, '');
  if (!/[0-9]/.test(digits)) return null;

  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');
  let normalized: string;

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalIsComma = lastComma > lastDot;
    normalized = decimalIsComma
      ? digits.replace(/\./g, '').replace(',', '.')
      : digits.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalized = /,[0-9]{2}$/.test(digits)
      ? digits.replace(/,/g, '.')
      : digits.replace(/,/g, '');
  } else {
    normalized = digits;
  }

  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

export function extractPriceFromText(text: string | undefined): string | null {
  if (!text) return null;
  const m = text.match(
    /(?:USD|GBP|EUR|\$|£|€)\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/i,
  );
  return m?.[1] ?? null;
}
