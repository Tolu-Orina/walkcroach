import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GetObjectCommand,
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
