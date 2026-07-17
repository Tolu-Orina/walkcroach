export type AgentMode = 'plan' | 'build';

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

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool?: string;
  awaitResult?: boolean;
};
