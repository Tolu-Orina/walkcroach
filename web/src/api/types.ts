export type CheckpointSummary = {
  id: string;
  projectId: string;
  sessionId: string | null;
  name: string | null;
  summary: string;
  createdAt: string;
};

export type PlanDecision = 'approve' | 'adjust' | 'cancel';

export type ProjectSummary = {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
  memorySummary: string | null;
  kind?: string;
  description?: string | null;
};

export type ProjectDetail = ProjectSummary & {
  ownerId: string;
  createdAt: string;
  templateId: string | null;
  instructions?: string | null;
};

export type ProjectDocument = {
  id: string;
  name: string;
  mime: string;
  byteSize: number;
  createdAt: string;
  hasText: boolean;
  chunkCount?: number;
  ingestStatus?: 'ok' | 'failed' | 'skipped';
};

export type ProjectMemoryEntry = {
  id: string;
  kind: string;
  text: string;
  sourceSurface: string;
  createdAt: string;
};

export type ProjectSession = {
  id: string;
  title: string | null;
  mode: string;
  createdAt: string;
};

export type AgentMode = 'plan' | 'build' | 'chat' | 'project_chat';

export type PlanFile = {
  path: string;
  reason: string;
  /** Truncated proposed content or edit diff from the deferred tool. */
  preview?: string;
};

export type PendingPlan = {
  planId: string;
  files: PlanFile[];
};

export type AgentEvent =
  | { type: 'token'; text: string }
  | {
      type: 'memory_recalled';
      count: number;
      kinds?: string[];
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
  | { type: 'plan_preview'; planId: string; files: PlanFile[] }
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
  | { type: 'checkpoint_created'; checkpointId: string; summary: string }
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

export type ActivityEvent = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string | null;
  at: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool?: string;
  awaitResult?: boolean;
  citations?: Array<{ title: string; url: string }>;
  attachments?: Array<{
    name: string;
    mime: string;
    textPreview: string;
    byteSize?: number;
  }>;
  /** Enriched memory hits for Builder recall cards. */
  memoryHits?: Array<{
    kind: string;
    text: string;
    sourceSurface?: string;
  }>;
  /** Inline image artifact payload (image_generated event). */
  image?: {
    assetId: string;
    prompt: string;
    dataUrl: string;
    storageKey?: string;
    width?: number;
    height?: number;
    remainingToday: number;
    dailyLimit: number;
  };
  /** Finished slide deck artefact. */
  deck?: {
    assetId: string;
    downloadName: string;
    slideCount: number;
    creditsCharged: number;
    previewUrl?: string | null;
    downloadUrl?: string | null;
  };
};
