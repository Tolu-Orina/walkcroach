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
  | { type: 'done'; reason: 'complete' | 'awaiting_tool' }
  | { type: 'error'; message: string };

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
