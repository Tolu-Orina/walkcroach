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
import { assertCredits, debitCredits } from './billing.js';

export type PromptBody = {
  message: string;
  projectId: string;
  mode?: 'plan' | 'build' | 'chat' | 'project_chat';
  attachments?: Array<{
    name: string;
    mime: string;
    textPreview: string;
    byteSize?: number;
    /** UTF-8 text body (text files) */
    contentText?: string;
    /** Base64 binary body (images / other) */
    contentBase64?: string;
  }>;
};

type StoredAttachmentMeta = {
  name: string;
  mime: string;
  textPreview: string;
  byteSize?: number;
  storageKey?: string;
};

async function persistAttachments(
  sessionId: string,
  raw: PromptBody['attachments'],
): Promise<StoredAttachmentMeta[] | undefined> {
  if (!raw?.length) return undefined;
  const out: StoredAttachmentMeta[] = [];
  for (const a of raw.slice(0, 5)) {
    if (!a || typeof a.name !== 'string' || typeof a.textPreview !== 'string') {
      continue;
    }
    const id = randomUUID();
    const meta: StoredAttachmentMeta = {
      name: a.name.slice(0, 200),
      mime: typeof a.mime === 'string' ? a.mime.slice(0, 120) : 'text/plain',
      textPreview: a.textPreview.slice(0, 20_000),
      byteSize:
        typeof a.byteSize === 'number' && Number.isFinite(a.byteSize)
          ? a.byteSize
          : undefined,
    };
    try {
      if (typeof a.contentText === 'string' && a.contentText.length > 0) {
        const key = attachmentStorageKey(sessionId, id);
        await putObject(key, a.contentText.slice(0, 2_000_000));
        meta.storageKey = key;
        meta.byteSize = meta.byteSize ?? Buffer.byteLength(a.contentText, 'utf8');
      } else if (
        typeof a.contentBase64 === 'string' &&
        a.contentBase64.length > 0
      ) {
        const key = attachmentStorageKey(sessionId, id);
        const buf = Buffer.from(a.contentBase64, 'base64');
        if (buf.length > 0 && buf.length <= 2 * 1024 * 1024) {
          await putObject(key, buf);
          meta.storageKey = key;
          meta.byteSize = meta.byteSize ?? buf.length;
        }
      } else if (a.textPreview && !a.textPreview.startsWith('[')) {
        // Fallback: persist text preview as the artefact body
        const key = attachmentStorageKey(sessionId, id);
        await putObject(key, a.textPreview);
        meta.storageKey = key;
      }
    } catch {
      // Keep meta without storageKey if put fails
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

    await writeNdjson(
      write,
      runPromptTurn({
        db,
        sessionId,
        projectId: body.projectId,
        message: body.message,
        mode,
        attachments,
      }),
    );
  } finally {
    await db.close();
  }
}
