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
  | {
      type: 'plan_preview';
      planId: string;
      files: Array<{ path: string; reason: string }>;
    }
  | { type: 'plan_awaiting_approval'; planId: string }
  | {
      type: 'done';
      reason: 'complete' | 'awaiting_tool' | 'awaiting_plan_approval';
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
};

export type MemoryKind = 'decision' | 'preference' | 'capture' | 'qa';

export type MemoryHit = {
  id: string;
  kind: MemoryKind;
  text: string;
  distance?: number;
};
