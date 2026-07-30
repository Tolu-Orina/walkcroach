/**
 * Streaming prompt handler (API Gateway ResponseTransferMode: STREAM).
 *
 * On Lambda, wrap with:
 *   export const handler = awslambda.streamifyResponse(streamHandler)
 *
 * Local server uses the same core via runPromptForLocal.
 */
import { randomUUID } from 'node:crypto';
import { createDbClient } from '@walkcroach/db';
import { runPromptTurn } from '@walkcroach/agent-harness';
import { attachmentStorageKey, putObject } from '../artefacts.js';
import { writeNdjson } from '../http.js';
import {
  assertCredits,
  debitCredits,
  getEntitlement,
  peekHardQuota,
} from './billing.js';

/** Nova text docs ≤4.5MB; media combined ≤25MB; API GW ~10MB with base64 → 5MB binary. */
const MAX_ATTACH_BYTES = 5 * 1024 * 1024;

export type PromptBody = {
  message: string;
  projectId: string;
  mode?: 'plan' | 'build' | 'chat' | 'project_chat';
  /** When false, system prompt disables web_search for this turn. */
  webSearchEnabled?: boolean;
  attachments?: Array<{
    name: string;
    mime: string;
    textPreview: string;
    byteSize?: number;
    /** UTF-8 text body (text files) */
    contentText?: string;
    /** Base64 binary body (images / documents) */
    contentBase64?: string;
  }>;
};

type StoredAttachment = {
  name: string;
  mime: string;
  textPreview: string;
  byteSize?: number;
  storageKey?: string;
  contentText?: string;
  bytes?: Uint8Array;
  ingestError?: string;
};

async function persistAttachments(
  sessionId: string,
  raw: PromptBody['attachments'],
): Promise<StoredAttachment[] | undefined> {
  if (!raw?.length) return undefined;
  const out: StoredAttachment[] = [];
  for (const a of raw.slice(0, 5)) {
    if (!a || typeof a.name !== 'string' || typeof a.textPreview !== 'string') {
      continue;
    }
    const id = randomUUID();
    const meta: StoredAttachment = {
      name: a.name.slice(0, 200),
      mime: typeof a.mime === 'string' ? a.mime.slice(0, 120) : 'text/plain',
      textPreview: a.textPreview.slice(0, 20_000),
      byteSize:
        typeof a.byteSize === 'number' && Number.isFinite(a.byteSize)
          ? a.byteSize
          : undefined,
    };

    const hasText =
      typeof a.contentText === 'string' && a.contentText.length > 0;
    const hasB64 =
      typeof a.contentBase64 === 'string' && a.contentBase64.length > 0;

    try {
      if (hasText) {
        const text = a.contentText!.slice(0, 2_000_000);
        const key = attachmentStorageKey(sessionId, id);
        await putObject(key, text);
        meta.storageKey = key;
        meta.contentText = text;
        meta.byteSize = meta.byteSize ?? Buffer.byteLength(text, 'utf8');
      } else if (hasB64) {
        const key = attachmentStorageKey(sessionId, id);
        const buf = Buffer.from(a.contentBase64!, 'base64');
        if (buf.length === 0) {
          meta.ingestError = 'empty file body';
        } else if (buf.length > MAX_ATTACH_BYTES) {
          meta.ingestError = `larger than ${MAX_ATTACH_BYTES / (1024 * 1024)} MB`;
        } else {
          await putObject(key, buf);
          meta.storageKey = key;
          meta.bytes = buf;
          meta.byteSize = meta.byteSize ?? buf.length;
        }
      } else if (a.textPreview && !a.textPreview.startsWith('[')) {
        const key = attachmentStorageKey(sessionId, id);
        await putObject(key, a.textPreview);
        meta.storageKey = key;
        meta.contentText = a.textPreview;
      } else if (a.textPreview.startsWith('[')) {
        // Client claimed a binary attach but sent no body
        meta.ingestError = 'file body missing from upload';
      }
    } catch (err) {
      meta.ingestError =
        err instanceof Error ? err.message : 'failed to store attachment';
    }
    out.push(meta);
  }
  return out.length ? out : undefined;
}

export async function runPromptStream(
  sessionId: string,
  body: PromptBody,
  write: (chunk: string) => void,
  ownerId?: string,
): Promise<void> {
  const db = createDbClient();
  try {
    if (ownerId) {
      const credits = await assertCredits(db, ownerId, 'agent_turn');
      if (!credits.ok) {
        await writeNdjson(
          write,
          (async function* () {
            yield {
              type: 'error' as const,
              message: `insufficient credits (${credits.remaining} remaining)`,
            };
          })(),
        );
        return;
      }
      const debit = await debitCredits(db, ownerId, 'agent_turn', body.projectId);
      if (!debit.ok) {
        await writeNdjson(
          write,
          (async function* () {
            yield {
              type: 'error' as const,
              message: `insufficient credits (${debit.remaining} remaining)`,
            };
          })(),
        );
        return;
      }
    }

    const attachments = await persistAttachments(sessionId, body.attachments);
    const mode =
      body.mode === 'plan' ||
      body.mode === 'build' ||
      body.mode === 'chat' ||
      body.mode === 'project_chat'
        ? body.mode
        : undefined;

    // Phase A — resolve creative limits (plan + rolling hard quota) once per
    // turn so generate_image can gate without extra round trips.
    const creativeLimits = ownerId
      ? {
          isPaid: (await getEntitlement(db, ownerId)) === 'paid',
          imageCreditCost: 5,
          imageDailyRemaining: (
            await peekHardQuota(db, ownerId, 'image_gen_daily')
          ).remaining,
          imageDailyLimit: 3,
          pptxCreditCost: 20,
          ownerId,
          debitCredits: async (
            actionType: string,
            metadata: Record<string, unknown> = {},
          ) => {
            const assert = await assertCredits(db, ownerId, actionType);
            if (!assert.ok) return { ok: false as const, remaining: assert.remaining };
            return debitCredits(
              db,
              ownerId,
              actionType,
              body.projectId,
              metadata,
            );
          },
        }
      : undefined;

    await writeNdjson(
      write,
      runPromptTurn({
        db,
        sessionId,
        projectId: body.projectId,
        message: body.message,
        mode,
        webSearchEnabled: body.webSearchEnabled !== false,
        creativeLimits,
        attachments,
      }),
    );
  } finally {
    await db.close();
  }
}
