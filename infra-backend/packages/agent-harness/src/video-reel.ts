/**
 * Amazon Nova Reel video client (Phase D2).
 *
 * Product default: MULTI_SHOT_AUTOMATED with durationSeconds=30 — one async
 * invoke returns a full 30s MP4 (not five separate TEXT_VIDEO jobs).
 *
 * @see https://docs.aws.amazon.com/nova/latest/userguide/video-gen-access.html
 */
import {
  BedrockRuntimeClient,
  GetAsyncInvokeCommand,
  StartAsyncInvokeCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  getBedrockReelRegion,
  getNovaReelModelId,
} from './bedrock.js';

export type ReelShot = {
  text: string;
  /** PNG/JPEG base64 (no data: prefix) — 1280×720 required. */
  imageBase64?: string;
  imageFormat?: 'png' | 'jpeg';
  /** Prefer S3 when stills are already in artefacts. */
  imageS3Uri?: string;
};

export type StartReelResult = {
  invocationArn: string;
  modelId: string;
  outputS3Uri: string;
  stub: boolean;
  taskType: 'MULTI_SHOT_AUTOMATED' | 'MULTI_SHOT_MANUAL';
  durationSec: number;
};

export type ReelStatus =
  | { status: 'InProgress' | 'Completed' | 'Failed'; invocationArn: string; outputS3Uri?: string; failureMessage?: string; stub?: boolean };

function reelClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({ region: getBedrockReelRegion() });
}

function videoStudioStub(): boolean {
  const v = (process.env.VIDEO_STUDIO_STUB ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function artefactsBucket(): string {
  return process.env.ARTEFACTS_BUCKET ?? process.env.ARTIFACTS_BUCKET ?? '';
}

function outputUri(ownerId: string, jobId: string): string {
  const bucket = artefactsBucket();
  const outputPrefix = `video-jobs/${ownerId}/${jobId}/reel`;
  return bucket
    ? `s3://${bucket}/${outputPrefix}`
    : `file://.local-artefacts/${outputPrefix}`;
}

/**
 * One Nova Reel job → full 30s video (MULTI_SHOT_AUTOMATED).
 * durationSeconds must be a multiple of 6 between 12 and 120; WalkCroach caps at 30.
 */
export async function startMultiShotAutomated(params: {
  jobId: string;
  ownerId: string;
  /** Single narrative prompt (≤4000 chars). */
  text: string;
  durationSec?: number;
  seed?: number;
}): Promise<StartReelResult> {
  const durationSec = Math.min(
    30,
    Math.max(12, Math.round((params.durationSec ?? 30) / 6) * 6),
  );
  const text = params.text.trim().slice(0, 4000);
  if (!text) throw new Error('reel prompt required');

  const modelId = getNovaReelModelId();
  const outputS3Uri = outputUri(params.ownerId, params.jobId);

  if (videoStudioStub() || !artefactsBucket()) {
    return {
      invocationArn: `stub:video:${params.jobId}`,
      modelId,
      outputS3Uri,
      stub: true,
      taskType: 'MULTI_SHOT_AUTOMATED',
      durationSec,
    };
  }

  const modelInput = {
    taskType: 'MULTI_SHOT_AUTOMATED',
    multiShotAutomatedParams: { text },
    videoGenerationConfig: {
      durationSeconds: durationSec,
      fps: 24,
      dimension: '1280x720',
      seed: params.seed ?? 42,
    },
  };

  const client = reelClient();
  const res = await client.send(
    new StartAsyncInvokeCommand({
      modelId,
      modelInput: modelInput as never,
      outputDataConfig: {
        s3OutputDataConfig: { s3Uri: outputS3Uri },
      },
    }),
  );
  if (!res.invocationArn) throw new Error('StartAsyncInvoke returned no ARN');
  return {
    invocationArn: res.invocationArn,
    modelId,
    outputS3Uri,
    stub: false,
    taskType: 'MULTI_SHOT_AUTOMATED',
    durationSec,
  };
}

/**
 * Optional MANUAL path (per-shot text/images). Prefer startMultiShotAutomated
 * for the product “30s at once” default.
 */
export async function startMultiShotManual(params: {
  jobId: string;
  ownerId: string;
  shots: ReelShot[];
  seed?: number;
}): Promise<StartReelResult> {
  const shots = params.shots.slice(0, 5);
  if (shots.length < 1) throw new Error('at least one shot required');
  if (shots.length * 6 > 30) throw new Error('duration exceeds 30s');

  const modelId = getNovaReelModelId();
  const outputS3Uri = outputUri(params.ownerId, params.jobId);
  const durationSec = shots.length * 6;

  if (videoStudioStub() || !artefactsBucket()) {
    return {
      invocationArn: `stub:video:${params.jobId}`,
      modelId,
      outputS3Uri,
      stub: true,
      taskType: 'MULTI_SHOT_MANUAL',
      durationSec,
    };
  }

  const modelInput = {
    taskType: 'MULTI_SHOT_MANUAL',
    multiShotManualParams: {
      shots: shots.map((s) => {
        const shotText = s.text.trim().slice(0, 512);
        const shot: Record<string, unknown> = { text: shotText };
        if (s.imageS3Uri) {
          shot.image = {
            format: s.imageFormat ?? 'png',
            source: { s3Location: { uri: s.imageS3Uri } },
          };
        } else if (s.imageBase64) {
          shot.image = {
            format: s.imageFormat ?? 'png',
            source: { bytes: s.imageBase64 },
          };
        }
        return shot;
      }),
    },
    videoGenerationConfig: {
      fps: 24,
      dimension: '1280x720',
      seed: params.seed ?? 42,
    },
  };

  const client = reelClient();
  const res = await client.send(
    new StartAsyncInvokeCommand({
      modelId,
      modelInput: modelInput as never,
      outputDataConfig: {
        s3OutputDataConfig: { s3Uri: outputS3Uri },
      },
    }),
  );
  if (!res.invocationArn) throw new Error('StartAsyncInvoke returned no ARN');
  return {
    invocationArn: res.invocationArn,
    modelId,
    outputS3Uri,
    stub: false,
    taskType: 'MULTI_SHOT_MANUAL',
    durationSec,
  };
}

export async function getReelStatus(invocationArn: string): Promise<ReelStatus> {
  if (invocationArn.startsWith('stub:')) {
    return { status: 'Completed', invocationArn, stub: true };
  }
  const client = reelClient();
  const res = await client.send(
    new GetAsyncInvokeCommand({ invocationArn }),
  );
  const status = (res.status ?? 'InProgress') as ReelStatus['status'];
  const out =
    res.outputDataConfig &&
    's3OutputDataConfig' in res.outputDataConfig &&
    res.outputDataConfig.s3OutputDataConfig?.s3Uri
      ? res.outputDataConfig.s3OutputDataConfig.s3Uri
      : undefined;
  return {
    status,
    invocationArn,
    outputS3Uri: out,
    failureMessage: res.failureMessage,
  };
}
