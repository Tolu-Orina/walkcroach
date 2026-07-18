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

type PriceFields = {
  price: number;
  currency: string;
  productName?: string;
  history: Array<{ price: number; currency: string; at: string }>;
};

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
      const history = Array.isArray(prev.history) ? [...prev.history] : [];
      history.push({ price: priceNum, currency, at: now });
      while (history.length > 100) history.shift();
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
        });
      }
      metricLog('chrome.capture.price_append', {
        historyLen: history.length,
        linked: Boolean(linkedProjectId),
      });
      return jsonResponse(200, {
        captureId: row.id,
        appended: true,
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

function coercePrice(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^0-9.,]/g, '').replace(/,/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function extractPriceFromText(text: string | undefined): string | null {
  if (!text) return null;
  const m = text.match(
    /(?:USD|GBP|EUR|\$|£|€)\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/i,
  );
  return m?.[1] ?? null;
}
