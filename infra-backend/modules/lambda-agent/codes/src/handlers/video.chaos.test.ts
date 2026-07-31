/**
 * Phase H2 — video pipeline chaos: Reel fail, compose/Polly fail, partial compose.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DbClient } from '@walkcroach/db';

vi.mock('@walkcroach/agent-harness', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@walkcroach/agent-harness')>();
  return {
    ...actual,
    startMultiShotAutomated: vi.fn(),
    getReelStatus: vi.fn(),
    invokeComposeVideo: vi.fn(),
    creativeMetric: vi.fn(),
  };
});

import {
  getReelStatus,
  invokeComposeVideo,
  startMultiShotAutomated,
  creativeMetric,
} from '@walkcroach/agent-harness';
import {
  handleVideoSfnStep,
  runVideoPipelineLocal,
} from './video.js';

type JobRow = {
  id: string;
  owner_id: string;
  shot_list: unknown;
  voiceover_script: string;
  duration_sec: number;
  aspect: string;
  invocation_arn: string | null;
  status: string;
  s3_key: string | null;
  preview_s3_key: string | null;
  credits_charged: number;
  images_consumed: number;
  error: unknown;
  created_at: Date;
  updated_at: Date;
};

function jobDb(initial: Partial<JobRow> = {}) {
  const row: JobRow = {
    id: '11111111-1111-1111-1111-111111111111',
    owner_id: 'owner-1',
    shot_list: [
      {
        taskType: 'MULTI_SHOT_AUTOMATED',
        reelPrompt: 'A 30s film',
        title: 'Teaser',
        brand: 'WalkCroach',
      },
    ],
    voiceover_script: 'Hello from WalkCroach.',
    duration_sec: 30,
    aspect: '16:9',
    invocation_arn: 'arn:reel:1',
    status: 'queued',
    s3_key: null,
    preview_s3_key: null,
    credits_charged: 270,
    images_consumed: 0,
    error: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...initial,
  };

  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/SELECT[\s\S]*FROM video_jobs/.test(sql)) {
        return { rows: [{ ...row }] };
      }
      if (/UPDATE video_jobs/.test(sql)) {
        if (/status = 'failed'/.test(sql)) {
          row.status = 'failed';
          row.error = params?.[1] ?? row.error;
        } else if (/status = 'ready'/.test(sql)) {
          row.status = 'ready';
          row.s3_key = String(params?.[1] ?? row.s3_key);
          if (params && params.length >= 3) row.error = params[2];
        } else if (/status = 'generating'/.test(sql)) {
          row.status = 'generating';
        } else if (/status = 'composing'/.test(sql)) {
          row.status = 'composing';
        } else if (/invocation_arn/.test(sql)) {
          row.invocation_arn = String(params?.[1] ?? row.invocation_arn);
        }
        return { rows: [] };
      }
      return { rows: [] };
    }),
    close: vi.fn(async () => {}),
  } as unknown as DbClient;

  return { db, row };
}

describe('Phase H2 — video chaos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(startMultiShotAutomated).mockResolvedValue({
      invocationArn: 'arn:reel:1',
      stub: true,
    } as Awaited<ReturnType<typeof startMultiShotAutomated>>);
  });

  it('Reel Failed marks job failed (inline pipeline)', async () => {
    const { db, row } = jobDb();
    vi.mocked(getReelStatus).mockResolvedValue({
      status: 'Failed',
      failureMessage: 'reel_provider_error',
    } as Awaited<ReturnType<typeof getReelStatus>>);
    await runVideoPipelineLocal(db, 'owner-1', row.id);
    expect(row.status).toBe('failed');
    expect(String(row.error)).toContain('reel_provider_error');
    expect(creativeMetric).toHaveBeenCalledWith(
      'VideoJobFail',
      expect.objectContaining({ feature: 'reel' }),
    );
  });

  it('Polly/compose hard fail marks job failed', async () => {
    const { db, row } = jobDb();
    vi.mocked(getReelStatus).mockResolvedValue({
      status: 'Completed',
    } as Awaited<ReturnType<typeof getReelStatus>>);
    vi.mocked(invokeComposeVideo).mockResolvedValue({
      ok: false,
      error: 'polly failed: AccessDenied',
    });
    await runVideoPipelineLocal(db, 'owner-1', row.id);
    expect(row.status).toBe('failed');
    expect(String(row.error)).toContain('polly failed');
    expect(creativeMetric).toHaveBeenCalledWith(
      'VideoJobFail',
      expect.objectContaining({ feature: 'compose' }),
    );
  });

  it('partial compose still lands ready with partialCompose note', async () => {
    const { db, row } = jobDb();
    vi.mocked(getReelStatus).mockResolvedValue({
      status: 'Completed',
    } as Awaited<ReturnType<typeof getReelStatus>>);
    vi.mocked(invokeComposeVideo).mockResolvedValue({
      ok: true,
      s3Key: 'video-jobs/owner-1/job/final.mp4',
      partialCompose: true,
      note: 'video-only mux fallback',
    });
    await runVideoPipelineLocal(db, 'owner-1', row.id);
    expect(row.status).toBe('ready');
    expect(row.s3_key).toBe('video-jobs/owner-1/job/final.mp4');
    expect(JSON.stringify(row.error)).toContain('partialCompose');
    expect(creativeMetric).toHaveBeenCalledWith(
      'VideoJobSuccess',
      expect.objectContaining({ feature: 'compose_partial' }),
    );
  });

  it('SFN poll Failed marks job failed', async () => {
    const { db, row } = jobDb({ invocation_arn: 'arn:reel:x' });
    vi.mocked(getReelStatus).mockResolvedValue({
      status: 'Failed',
      failureMessage: 'nova reel timeout',
    } as Awaited<ReturnType<typeof getReelStatus>>);
    const out = await handleVideoSfnStep(db, {
      step: 'poll',
      jobId: row.id,
      ownerId: 'owner-1',
    });
    expect(out.reelStatus).toBe('Failed');
    expect(row.status).toBe('failed');
  });
});
