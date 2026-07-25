import { randomBytes } from 'node:crypto';
import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { metricLog, parseJsonBody, truncateExtract } from '../util.js';

const CODE_TTL_MS = 10 * 60_000;
const MAX_HANDOFF_EXTRACT = 8_000;

function newCode(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * POST /chrome/v1/chat-handoff
 * Store page context for Web Chat deep-link (short code in URL only).
 */
export async function handleCreateChatHandoff(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const parsed = parseJsonBody<{
    title?: string;
    url?: string;
    extractedText?: string;
    question?: string;
  }>(rawBody);
  if ('error' in parsed && parsed.error === 'invalid JSON body') {
    return jsonResponse(400, { error: parsed.error });
  }
  const body = parsed as {
    title?: string;
    url?: string;
    extractedText?: string;
    question?: string;
  };
  const extract = truncateExtract(body.extractedText ?? '', MAX_HANDOFF_EXTRACT);
  if (extract.length < 20) {
    return jsonResponse(400, { error: 'extractedText too short' });
  }

  const code = newCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  const db = createDbClient();
  try {
    await db.query(
      `DELETE FROM chrome_chat_handoffs
       WHERE code_expires_at < now() OR consumed_at IS NOT NULL`,
    );
    await db.query(
      `INSERT INTO chrome_chat_handoffs (
         code, owner_id, title, url, extract_text, question, code_expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        code,
        auth.ownerId,
        body.title?.trim() || null,
        body.url?.trim() || null,
        extract,
        body.question?.trim() || null,
        expiresAt.toISOString(),
      ],
    );
    metricLog('chrome.chat.handoff_create', { ok: true });
    return jsonResponse(200, {
      code,
      expiresIn: Math.floor(CODE_TTL_MS / 1000),
    });
  } finally {
    await db.close();
  }
}

/**
 * GET /chrome/v1/chat-handoff/:code — public one-time consume for Web Chat.
 */
export async function handleConsumeChatHandoff(
  codeParam: string,
): Promise<ReturnType<typeof jsonResponse>> {
  const code = codeParam?.trim();
  if (!code || code.length < 16) {
    return jsonResponse(400, { error: 'invalid code' });
  }

  const db = createDbClient();
  try {
    const { rows } = await db.query<{
      title: string | null;
      url: string | null;
      extract_text: string;
      question: string | null;
    }>(
      `UPDATE chrome_chat_handoffs
       SET consumed_at = now()
       WHERE code = $1
         AND consumed_at IS NULL
         AND code_expires_at > now()
       RETURNING title, url, extract_text, question`,
      [code],
    );
    const row = rows[0];
    if (!row) {
      return jsonResponse(404, { error: 'handoff not found or expired' });
    }
    await db.query(`DELETE FROM chrome_chat_handoffs WHERE code = $1`, [code]);
    metricLog('chrome.chat.handoff_consume', { ok: true });
    return jsonResponse(200, {
      title: row.title,
      url: row.url,
      extractedText: row.extract_text,
      question: row.question,
    });
  } finally {
    await db.close();
  }
}
