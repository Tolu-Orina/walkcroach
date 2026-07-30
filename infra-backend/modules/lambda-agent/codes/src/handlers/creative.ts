/**
 * Creative assets REST — Phase B confirm / list / download.
 */
import type { DbClient } from '@walkcroach/db';
import { invokeRenderPptx } from '@walkcroach/agent-harness';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { getPresignedGetUrl } from '../artefacts.js';
import {
  assertCredits,
  debitCredits,
  getEntitlement,
  peekHardQuota,
} from './billing.js';

type RestResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

export async function handleListCreativeAssets(
  db: DbClient,
  auth: AuthContext,
  query: { limit?: number },
): Promise<RestResult> {
  const limit = Math.min(50, Math.max(1, Number(query.limit ?? 20)));
  const { rows } = await db.query<{
    id: string;
    kind: string;
    status: string;
    download_name: string | null;
    preview_s3_key: string | null;
    s3_key: string | null;
    credits_charged: number;
    images_consumed: number;
    created_at: Date;
    brief: Record<string, unknown>;
  }>(
    `SELECT id, kind, status, download_name, preview_s3_key, s3_key,
            credits_charged, images_consumed, created_at, brief
     FROM creative_assets
     WHERE owner_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [auth.ownerId, limit],
  );
  return jsonResponse(200, {
    assets: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      downloadName: r.download_name,
      hasPreview: Boolean(r.preview_s3_key),
      hasFile: Boolean(r.s3_key),
      creditsCharged: r.credits_charged,
      imagesConsumed: r.images_consumed,
      title: typeof r.brief?.title === 'string' ? r.brief.title : null,
      createdAt: r.created_at.toISOString(),
    })),
  });
}

export async function handleConfirmCreativeRender(
  db: DbClient,
  auth: AuthContext,
  assetId: string,
): Promise<RestResult> {
  const plan = await getEntitlement(db, auth.ownerId);
  if (plan !== 'paid') {
    return jsonResponse(402, { error: 'paid_plan_required' });
  }

  const { rows } = await db.query<{
    id: string;
    owner_id: string;
    brief: Record<string, unknown>;
    status: string;
    images_consumed: number;
  }>(
    `SELECT id, owner_id, brief, status, images_consumed
     FROM creative_assets WHERE id = $1::uuid`,
    [assetId],
  );
  const row = rows[0];
  if (!row || row.owner_id !== auth.ownerId) {
    return jsonResponse(404, { error: 'not_found' });
  }
  if (row.status === 'ready' && row) {
    // Idempotent re-fetch
    return jsonResponse(200, { ok: true, assetId, status: 'ready', alreadyReady: true });
  }

  const imageNeed = Number(row.images_consumed ?? 0);
  if (imageNeed > 0) {
    const peek = await peekHardQuota(db, auth.ownerId, 'image_gen_daily');
    if (peek.remaining < imageNeed) {
      return jsonResponse(429, {
        error: 'image_quota_exceeded',
        remaining: peek.remaining,
        needed: imageNeed,
      });
    }
  }

  const credits = await assertCredits(db, auth.ownerId, 'render_pptx');
  if (!credits.ok) {
    return jsonResponse(402, {
      error: 'insufficient_credits',
      remaining: credits.remaining,
    });
  }

  await db.query(
    `UPDATE creative_assets SET status = 'generating', updated_at = now() WHERE id = $1::uuid`,
    [assetId],
  );

  const debit = await debitCredits(db, auth.ownerId, 'render_pptx', undefined, {
    assetId,
  });
  if (!debit.ok) {
    await db.query(
      `UPDATE creative_assets SET status = 'proposed', updated_at = now() WHERE id = $1::uuid`,
      [assetId],
    );
    return jsonResponse(402, {
      error: 'insufficient_credits',
      remaining: debit.remaining,
    });
  }

  const rendered = await invokeRenderPptx({
    brief: row.brief,
    ownerId: auth.ownerId,
    assetId,
  });

  if (!rendered.ok) {
    await db.query(
      `UPDATE creative_assets
       SET status = 'failed', error = $2, updated_at = now()
       WHERE id = $1::uuid`,
      [assetId, (rendered.error ?? 'render failed').slice(0, 1000)],
    );
    return jsonResponse(500, {
      error: 'render_failed',
      detail: rendered.error,
      validation: rendered.stdout,
    });
  }

  await db.query(
    `UPDATE creative_assets
     SET status = 'ready',
         s3_key = $2,
         preview_s3_key = $3,
         download_name = $4,
         credits_charged = 20,
         updated_at = now()
     WHERE id = $1::uuid`,
    [
      assetId,
      rendered.s3Key ?? null,
      rendered.previewS3Key ?? null,
      rendered.downloadName ?? 'deck.pptx',
    ],
  );

  let downloadUrl: string | null = null;
  let previewUrl: string | null = null;
  try {
    if (rendered.s3Key) {
      downloadUrl = await getPresignedGetUrl(rendered.s3Key, 900);
    }
    if (rendered.previewS3Key) {
      previewUrl = await getPresignedGetUrl(rendered.previewS3Key, 900);
    }
  } catch {
    // local file:// keys may not presign
  }

  return jsonResponse(200, {
    ok: true,
    assetId,
    status: 'ready',
    downloadName: rendered.downloadName,
    slideCount: rendered.slideCount,
    downloadUrl,
    previewUrl,
    s3Key: rendered.s3Key,
    previewS3Key: rendered.previewS3Key,
    remainingCredits: debit.remaining,
  });
}

export async function handleCreativeDownloadUrl(
  db: DbClient,
  auth: AuthContext,
  assetId: string,
): Promise<RestResult> {
  const { rows } = await db.query<{
    owner_id: string;
    s3_key: string | null;
    download_name: string | null;
    status: string;
  }>(
    `SELECT owner_id, s3_key, download_name, status FROM creative_assets WHERE id = $1::uuid`,
    [assetId],
  );
  const row = rows[0];
  if (!row || row.owner_id !== auth.ownerId) {
    return jsonResponse(404, { error: 'not_found' });
  }
  if (row.status !== 'ready' || !row.s3_key) {
    return jsonResponse(409, { error: 'not_ready' });
  }
  const url = await getPresignedGetUrl(row.s3_key, 900);
  return jsonResponse(200, {
    url,
    downloadName: row.download_name ?? 'deck.pptx',
  });
}
