/**
 * Shared object storage for the WalkCroach backend.
 *
 * Extracted so every surface signs uploads the same way rather than each Lambda
 * growing its own S3 helper. `lambda-agent/src/artefacts.ts` predates this and
 * still has its own copy of the get/put half; it should migrate here, but is
 * left alone for now because it is deployed and out of scope for this change.
 *
 * Local development has no bucket. Rather than failing, every function degrades
 * to the repo-local `.local-artefacts` directory — the same convention
 * `artefacts.ts` uses — so `npm run dev:chrome` works with no AWS credentials.
 */
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const LOCAL_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '.local-artefacts',
);

/**
 * A dedicated captures bucket if configured, otherwise the shared artefacts
 * bucket. Screenshots are user content with their own retention rules, so
 * separating them is preferred in production.
 */
export function bucketName(): string | null {
  return (
    process.env.CAPTURES_BUCKET?.trim() ||
    process.env.ARTEFACTS_BUCKET?.trim() ||
    null
  );
}

export function hasBucket(): boolean {
  return bucketName() !== null;
}

function s3(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION ?? process.env.BEDROCK_REGION ?? 'eu-west-2',
  });
}

function localPath(key: string): string {
  return join(LOCAL_ROOT, key.split('/').join(sep));
}

/**
 * Screenshots are namespaced by owner so a presigned URL can never be minted
 * for a key outside the caller's own space — see `ownsKey`.
 */
export function screenshotKey(ownerId: string, captureId: string): string {
  const owner = ownerId.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 120);
  const id = captureId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return `chrome/${owner}/screenshots/${id}.jpg`;
}

/** Defence in depth: refuse to sign or read a key from another owner's space. */
export function ownsKey(ownerId: string, key: string): boolean {
  if (key.includes('..')) return false;
  const owner = ownerId.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 120);
  return key.startsWith(`chrome/${owner}/`);
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const bucket = bucketName();
  if (bucket) {
    await s3().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
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
    if (!bytes) throw new Error(`empty object: ${key}`);
    return Buffer.from(bytes);
  }
  return readFile(localPath(key));
}

export async function deleteObject(key: string): Promise<void> {
  const bucket = bucketName();
  if (bucket) {
    await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return;
  }
  await unlink(localPath(key)).catch(() => undefined);
}

/**
 * Presigned PUT so image bytes go straight to S3 and never traverse the Lambda.
 *
 * Returns null when no bucket is configured, which is the signal for the caller
 * to offer the direct-upload path instead. `ContentType` is bound into the
 * signature, so the client must send exactly this header.
 */
export async function presignPut(
  key: string,
  contentType: string,
  expiresInSeconds = 300,
): Promise<string | null> {
  const bucket = bucketName();
  if (!bucket) return null;
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
    }),
    { expiresIn: expiresInSeconds },
  );
}

export async function presignGet(
  key: string,
  expiresInSeconds = 900,
): Promise<string | null> {
  const bucket = bucketName();
  if (!bucket) return null;
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: expiresInSeconds,
  });
}
