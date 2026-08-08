import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const LOCAL_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.local-artefacts',
);

export type SnapshotFile = { path: string; content: string };

export type ProjectSnapshot = {
  version: 1;
  createdAt: string;
  files: SnapshotFile[];
};

function bucketName(): string | null {
  return process.env.ARTEFACTS_BUCKET ?? null;
}

function s3(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION ?? process.env.BEDROCK_REGION ?? 'eu-west-2',
  });
}

function localPath(key: string): string {
  return join(LOCAL_ROOT, key.split('/').join(sep));
}

export function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function fileStorageKey(projectId: string, path: string): string {
  const safe = path.replace(/^\/+/, '').replace(/\\/g, '/');
  return `projects/${projectId}/files/${safe}`;
}

export function checkpointStorageKey(projectId: string, checkpointId: string): string {
  return `projects/${projectId}/checkpoints/${checkpointId}.json`;
}

export function exportStorageKey(projectId: string, exportId: string): string {
  return `projects/${projectId}/exports/${exportId}.zip`;
}

export function attachmentStorageKey(
  sessionId: string,
  attachmentId: string,
): string {
  const safe = attachmentId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return `sessions/${sessionId}/attachments/${safe}`;
}

export async function putObject(key: string, body: Buffer | string): Promise<void> {
  const bucket = bucketName();
  if (bucket) {
    await s3().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: typeof body === 'string' ? Buffer.from(body, 'utf8') : body,
        ContentType: key.endsWith('.zip')
          ? 'application/zip'
          : key.includes('/attachments/')
            ? 'application/octet-stream'
            : 'application/json',
      }),
    );
    return;
  }
  const target = localPath(key);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body);
}

export async function getObject(key: string): Promise<Buffer> {
  const bucket = bucketName();
  if (bucket) {
    const res = await s3().send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Empty object: ${key}`);
    return Buffer.from(bytes);
  }
  return readFile(localPath(key));
}

export async function getPresignedGetUrl(
  key: string,
  expiresInSeconds = 900,
): Promise<string> {
  const bucket = bucketName();
  if (!bucket) {
    return `file://${localPath(key)}`;
  }
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

/** Delete one object from artefacts bucket or local fallback. */
export async function deleteObject(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) return;
  const bucket = bucketName();
  if (bucket) {
    await s3().send(
      new DeleteObjectCommand({ Bucket: bucket, Key: trimmed }),
    );
    return;
  }
  try {
    await unlink(localPath(trimmed));
  } catch {
    /* already gone */
  }
}

/** Batch-delete keys (S3 multi-delete in chunks of 1000). Returns deleted count. */
export async function deleteObjects(keys: string[]): Promise<number> {
  const unique = [
    ...new Set(keys.map((k) => k.trim()).filter(Boolean)),
  ];
  if (unique.length === 0) return 0;
  const bucket = bucketName();
  if (!bucket) {
    let n = 0;
    for (const key of unique) {
      try {
        await unlink(localPath(key));
        n += 1;
      } catch {
        /* skip */
      }
    }
    return n;
  }
  let deleted = 0;
  for (let i = 0; i < unique.length; i += 1000) {
    const chunk = unique.slice(i, i + 1000);
    const res = await s3().send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
    deleted += res.Deleted?.length ?? chunk.length;
  }
  return deleted;
}

/**
 * Delete every object under a key prefix (e.g. `projects/{id}/`).
 * Used on account erase so checkpoints/files/exports do not linger.
 */
export async function deletePrefix(prefix: string): Promise<number> {
  const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const bucket = bucketName();
  if (!bucket) {
    const root = localPath(normalized.replace(/\/$/, ''));
    try {
      await rm(root, { recursive: true, force: true });
      return 1;
    } catch {
      return 0;
    }
  }
  let deleted = 0;
  let token: string | undefined;
  do {
    const page = await s3().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: normalized,
        ContinuationToken: token,
      }),
    );
    const keys = (page.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => Boolean(k));
    deleted += await deleteObjects(keys);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

export async function writeSnapshot(
  storageKey: string,
  snapshot: ProjectSnapshot,
): Promise<void> {
  await putObject(storageKey, JSON.stringify(snapshot));
}

export async function readSnapshot(storageKey: string): Promise<ProjectSnapshot> {
  const raw = await getObject(storageKey);
  return JSON.parse(raw.toString('utf8')) as ProjectSnapshot;
}
