/**
 * Nova Canvas image generation for the Web harness.
 *
 * This is the model call only. Entitlement (paid), hard quota (3/24h) and
 * credits (5) are enforced in loop.ts before this is invoked. The
 * check_image_asset.py QA script from skills/web is a Phase B/Creative-Lambda
 * concern — Phase A stores the asset and reports dimensions for later QA.
 */
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { getBedrockRegion, getNovaCanvasModelId } from './bedrock.js';

let s3: S3Client | null = null;
function s3Client(): S3Client {
  s3 ??= new S3Client({ region: getBedrockRegion() });
  return s3;
}

const ARTEFACTS_BUCKET = () =>
  process.env.ARTEFACTS_BUCKET ?? process.env.ARTIFACTS_BUCKET ?? '';

export type GeneratedImage = {
  prompt: string;
  modelId: string;
  mime: 'image/png' | 'image/jpeg';
  width?: number;
  height?: number;
  /** Base64 data URL for immediate inline preview in Chat. */
  dataUrl: string;
  /** Durable object key when a bucket is configured (lambda uses artefacts). */
  storageKey?: string;
  assetId: string;
};

function decodeImageSize(buf: Buffer): { width?: number; height?: number } {
  // PNG: 16-17-18-19 big-endian width/height after IHDR 'IHDR'.
  if (buf.length > 24 && buf.readUInt32BE(16) === 0x49484452) {
    return { width: buf.readUInt32BE(16 + 4), height: buf.readUInt32BE(16 + 8) };
  }
  return {};
}

export async function generateCanvasImage(params: {
  prompt: string;
  aspect?: 'square' | 'landscape' | 'portrait';
  negativePrompt?: string;
}): Promise<GeneratedImage> {
  const client = new BedrockRuntimeClient({ region: getBedrockRegion() });
  const modelId = getNovaCanvasModelId();
  const cfg =
    params.aspect === 'landscape'
      ? { width: 1280, height: 720 }
      : params.aspect === 'portrait'
        ? { width: 720, height: 1280 }
        : { width: 1024, height: 1024 };

  const body = {
    taskType: 'TEXT_IMAGE',
    textToImageParams: {
      text: params.prompt,
      ...(params.negativePrompt
        ? { negativeText: params.negativePrompt }
        : {}),
    },
    imageGenerationConfig: {
      numberOfImages: 1,
      quality: 'premium',
      height: cfg.height,
      width: cfg.width,
      cfgScale: 8.0,
    },
  };

  const res = await client.send(
    new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    }),
  );
  const parsed = JSON.parse(new TextDecoder().decode(res.body)) as {
    images?: string[];
    error?: string;
  };
  if (parsed.error) throw new Error(parsed.error);
  const b64 = parsed.images?.[0];
  if (!b64) throw new Error('Nova Canvas returned no image');
  const buf = Buffer.from(b64, 'base64');
  const size = decodeImageSize(buf);
  const assetId = randomUUID();

  let storageKey: string | undefined;
  const bucket = ARTEFACTS_BUCKET();
  if (bucket) {
    storageKey = `creative-images/${assetId}.png`;
    try {
      await s3Client().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: storageKey,
          Body: buf,
          ContentType: 'image/png',
        }),
      );
    } catch {
      storageKey = undefined; // preview still works without persistence
    }
  }

  return {
    prompt: params.prompt,
    modelId,
    mime: 'image/png',
    width: size.width ?? cfg.width,
    height: size.height ?? cfg.height,
    dataUrl: `data:image/png;base64,${b64}`,
    storageKey,
    assetId,
  };
}
