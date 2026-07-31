export type AgentEvent =
  | { type: 'token'; text: string }
  | {
      type: 'memory_recalled';
      count: number;
      kinds?: string[];
      /** Surfaced hits for Builder UI (truncated). */
      hits?: Array<{
        kind: string;
        text: string;
        sourceSurface?: string;
      }>;
    }
  | {
      type: 'tool_call';
      id: string;
      tool: string;
      args: Record<string, unknown>;
      awaitResult?: boolean;
    }
  | {
      type: 'plan_preview';
      planId: string;
      files: Array<{ path: string; reason: string; preview?: string }>;
    }
  | { type: 'plan_awaiting_approval'; planId: string }
  | {
      type: 'image_generated';
      assetId: string;
      prompt: string;
      dataUrl: string;
      storageKey?: string;
      width?: number;
      height?: number;
      remainingToday: number;
      dailyLimit: number;
    }
  | { type: 'image_credit_required'; credits: number; prompt: string }
  | {
      type: 'upgrade_required';
      reason:
        | 'paid_plan_required'
        | 'insufficient_credits'
        | 'image_quota_exceeded'
        | 'video_quota_exceeded';
      message: string;
      feature?: string;
    }
  | {
      type: 'creative_brief_ready';
      assetId: string;
      kind: 'slide_deck' | 'flyer';
      brief: Record<string, unknown>;
      credits: number;
      estimatedImages: number;
      remainingImages: number;
      imageDailyLimit: number;
      stub?: boolean;
    }
  | {
      type: 'creative_asset_ready';
      assetId: string;
      kind: 'slide_deck' | 'flyer';
      downloadName: string;
      s3Key: string;
      previewS3Key?: string | null;
      previewDataUrl?: string;
      slideCount?: number;
      creditsCharged: number;
    }
  | {
      type: 'video_brief_ready';
      jobId: string;
      brief: Record<string, unknown>;
      credits: number;
      estimatedImages: number;
      remainingImages: number;
      imageDailyLimit: number;
      remainingVideo: number;
      videoLimit: number;
      videoResetAt?: string;
      stub?: boolean;
    }
  | {
      type: 'video_job_updated';
      jobId: string;
      status: string;
      durationSec?: number;
      aspect?: string;
      creditsCharged?: number;
      downloadUrl?: string | null;
      error?: string;
    }
  | {
      type: 'connector_action_proposed';
      runId: string;
      action: string;
      title: string;
      consequence: string;
      write: boolean;
      /** Cannot be taken back once executed. A strict subset of `write`. */
      irreversible: boolean;
      weight: number;
      rows: Array<{ label: string; value: string }>;
      needsConnection?: string;
      connectUrl?: string;
    }
  | { type: 'warning'; message: string }
  | {
      type: 'done';
      reason:
        | 'complete'
        | 'awaiting_tool'
        | 'awaiting_plan_approval'
        | 'stuck_tool_loop';
    }
  | { type: 'error'; message: string };

export type PlanDecision = 'approve' | 'adjust' | 'cancel';

export type PlanDecisionInput = {
  planId: string;
  decision: PlanDecision;
  adjustment?: string;
};

export type ToolResultInput = {
  toolCallId: string;
  ok: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  output?: string;
  /**
   * When true with ok:false (Stop), close any remaining queued client tools,
   * mark the session active, and do not continue the agent loop.
   */
  cancelRemaining?: boolean;
};

export type MemoryKind =
  | 'decision'
  | 'preference'
  | 'capture'
  | 'qa'
  | 'convention'
  | 'summary';

export type MemoryHit = {
  id: string;
  kind: MemoryKind;
  text: string;
  distance?: number;
  sourceSurface?: string;
};
