/**
 * Minimal UI-facing events shared across loops (P4.1 optional subset).
 * Does NOT unify harness AgentEvent with engine AgentEvent — only the
 * memory-facing chip that both Web Builder and coding hosts can render.
 */
export type SharedMemoryUiEvent = {
  type: 'memory_recalled';
  count: number;
  kinds?: string[];
  hits?: Array<{
    kind: string;
    text: string;
    sourceSurface?: string;
  }>;
};
