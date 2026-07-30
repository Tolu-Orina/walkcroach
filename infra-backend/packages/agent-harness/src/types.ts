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
      type: 'creative_brief_ready';
      assetId: string;
      kind: 'slide_deck';
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
      kind: 'slide_deck';
      downloadName: string;
      s3Key: string;
      previewS3Key?: string | null;
      previewDataUrl?: string;
      slideCount: number;
      creditsCharged: number;
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
