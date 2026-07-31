/**
 * Creative assets REST — Phase B/C confirm / list / download.
 */
import type { DbClient } from '@walkcroach/db';
import {
  invokeRenderPptx,
  invokeRenderFlyer,
  embedAndStoreCreativeAsset,
  moderateCreativeCopy,
  saveCreativeToProjectMemory,
} from '@walkcroach/agent-harness';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { getPresignedGetUrl } from '../artefacts.js';
import {
  assertCredits,
  debitCredits,
  getEntitlement,
  refundCredits,
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
      title:
        typeof r.brief?.title === 'string'
          ? r.brief.title
          : typeof r.brief?.headline === 'string'
            ? r.brief.headline
            : null,
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
    kind: string;
    brief: Record<string, unknown>;
    status: string;
    images_consumed: number;
  }>(
    `SELECT id, owner_id, kind, brief, status, images_consumed
     FROM creative_assets WHERE id = $1::uuid`,
    [assetId],
  );
  const row = rows[0];
  if (!row || row.owner_id !== auth.ownerId) {
    return jsonResponse(404, { error: 'not_found' });
  }
  if (row.status === 'ready') {
    return jsonResponse(200, {
      ok: true,
      assetId,
      status: 'ready',
      alreadyReady: true,
      kind: row.kind,
    });
  }

  const kind = row.kind === 'flyer' ? 'flyer' : 'slide_deck';
  const actionType = kind === 'flyer' ? 'render_flyer' : 'render_pptx';
  const creditCost = kind === 'flyer' ? 10 : 20;

  const mod = await moderateCreativeCopy({
    title: typeof row.brief?.title === 'string' ? row.brief.title : undefined,
    headline:
      typeof row.brief?.headline === 'string' ? row.brief.headline : undefined,
    support:
      typeof row.brief?.support === 'string' ? row.brief.support : undefined,
    cta: typeof row.brief?.cta === 'string' ? row.brief.cta : undefined,
    slides: Array.isArray(row.brief?.slides)
      ? (row.brief.slides as Array<{ title?: string; bullets?: string[] }>)
      : undefined,
  });
  if (!mod.ok) {
    return jsonResponse(422, {
      error: 'marketing_moderation_blocked',
      reasons: mod.reasons,
      source: mod.source,
    });
  }

  // Canvas hard quota applies only when Nova Canvas stills are generated
  // (generate_image). Deck/flyer render does not call Canvas today — do not
  // burn image_gen_daily here (was exhausting the 3/24h cap without stills).

  const credits = await assertCredits(db, auth.ownerId, actionType);
  if (!credits.ok) {
    return jsonResponse(402, {
      error: 'insufficient_credits',
      remaining: credits.remaining,
    });
  }

  // Atomic claim proposed→generating so double-confirm cannot double-debit.
  const { rows: claimed } = await db.query<{ id: string }>(
    `UPDATE creative_assets
     SET status = 'generating', updated_at = now()
     WHERE id = $1::uuid AND owner_id = $2 AND status = 'proposed'
     RETURNING id`,
    [assetId, auth.ownerId],
  );
  if (!claimed[0]) {
    const { rows: again } = await db.query<{ status: string }>(
      `SELECT status FROM creative_assets WHERE id = $1::uuid`,
      [assetId],
    );
    if (again[0]?.status === 'ready') {
      return jsonResponse(200, {
        ok: true,
        assetId,
        status: 'ready',
        alreadyReady: true,
        kind: row.kind,
      });
    }
    if (again[0]?.status === 'generating') {
      return jsonResponse(200, {
        ok: true,
        assetId,
        status: 'generating',
        alreadyStarted: true,
        kind: row.kind,
      });
    }
    return jsonResponse(409, {
      error: 'invalid_status',
      status: again[0]?.status ?? 'unknown',
    });
  }

  const debit = await debitCredits(db, auth.ownerId, actionType, undefined, {
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

  const rendered =
    kind === 'flyer'
      ? await invokeRenderFlyer({
          brief: row.brief,
          ownerId: auth.ownerId,
          assetId,
        })
      : await invokeRenderPptx({
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
    await refundCredits(db, auth.ownerId, actionType, creditCost, undefined, {
      assetId,
      reason: 'render_failed',
    });
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
         credits_charged = $5,
         updated_at = now()
     WHERE id = $1::uuid`,
    [
      assetId,
      rendered.s3Key ?? null,
      rendered.previewS3Key ?? null,
      rendered.downloadName ?? (kind === 'flyer' ? 'flyer.pdf' : 'deck.pptx'),
      creditCost,
    ],
  );

  try {
    const altText =
      typeof row.brief?.altText === 'string'
        ? row.brief.altText
        : typeof row.brief?.alt_text === 'string'
          ? row.brief.alt_text
          : null;
    await embedAndStoreCreativeAsset({
      db,
      assetId,
      kind,
      brief: row.brief,
      altText,
      downloadName: rendered.downloadName ?? null,
    });
    if (altText) {
      await db.query(
        `UPDATE creative_assets SET alt_text = $2, updated_at = now() WHERE id = $1::uuid`,
        [assetId, altText],
      );
    }
  } catch {
    /* Titan may be unavailable in local/dev */
  }

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

  const previewDataUrl =
    kind === 'flyer' && 'previewDataUrl' in rendered
      ? (rendered as { previewDataUrl?: string }).previewDataUrl
      : undefined;

  return jsonResponse(200, {
    ok: true,
    assetId,
    kind,
    status: 'ready',
    downloadName: rendered.downloadName,
    slideCount: rendered.slideCount,
    downloadUrl,
    previewUrl: previewUrl ?? previewDataUrl ?? null,
    previewDataUrl: previewDataUrl ?? null,
    s3Key: rendered.s3Key,
    previewS3Key: rendered.previewS3Key,
    remainingCredits: debit.remaining,
    creditsCharged: creditCost,
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
    downloadName: row.download_name ?? 'artefact',
  });
}

/** Phase E1 — Save finished creative into project memory_entries. */
export async function handleRememberCreative(
  db: DbClient,
  auth: AuthContext,
  assetId: string,
  body: { projectId?: string; note?: string },
): Promise<RestResult> {
  const projectId = body.projectId?.trim();
  if (!projectId) {
    return jsonResponse(400, { error: 'project_id_required' });
  }
  const { rows } = await db.query<{
    id: string;
    owner_id: string;
    kind: string;
    brief: Record<string, unknown>;
    status: string;
  }>(
    `SELECT id, owner_id, kind, brief, status FROM creative_assets WHERE id = $1::uuid`,
    [assetId],
  );
  const row = rows[0];
  if (!row || row.owner_id !== auth.ownerId) {
    return jsonResponse(404, { error: 'not_found' });
  }
  if (row.status !== 'ready') {
    return jsonResponse(409, { error: 'not_ready' });
  }
  const title =
    (typeof row.brief?.title === 'string' && row.brief.title) ||
    (typeof row.brief?.headline === 'string' && row.brief.headline) ||
    row.kind;
  const memoryId = await saveCreativeToProjectMemory({
    db,
    projectId,
    assetId,
    kind: row.kind,
    title,
    note: body.note,
  });
  return jsonResponse(200, { ok: true, memoryId, assetId });
}
