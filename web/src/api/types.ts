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
};

export type ProjectDetail = ProjectSummary & {
  ownerId: string;
  createdAt: string;
  templateId: string | null;
};

export type AgentMode = 'plan' | 'build';

export type PlanFile = { path: string; reason: string };

export type PendingPlan = {
  planId: string;
  files: PlanFile[];
};

export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'memory_recalled'; count: number; kinds?: string[] }
  | {
      type: 'tool_call';
      id: string;
      tool: string;
      args: Record<string, unknown>;
      awaitResult?: boolean;
    }
  | { type: 'plan_preview'; planId: string; files: PlanFile[] }
  | { type: 'plan_awaiting_approval'; planId: string }
  | { type: 'checkpoint_created'; checkpointId: string; summary: string }
  | {
      type: 'done';
      reason: 'complete' | 'awaiting_tool' | 'awaiting_plan_approval';
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
};
