/**
 * Client-side SandboxRuntime contract (mirrors agent-harness).
 * Primary runtime: E2B (server-orchestrated). WebContainer is legacy fallback.
 */
export type SandboxRunResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type SandboxRuntimeInfo = {
  runtime: 'e2b' | 'webcontainer' | 'none';
  sandboxId: string | null;
  previewUrl: string | null;
};

export interface SandboxRuntime {
  readonly kind: SandboxRuntimeInfo['runtime'];
  boot(opts?: { templateId?: string }): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  editFile(path: string, oldStr: string, newStr: string): Promise<void>;
  runTerminal(cmd: string): Promise<SandboxRunResult>;
  getInfo(): SandboxRuntimeInfo;
  dispose(): Promise<void>;
}

/** Feature flag — set VITE_SANDBOX_RUNTIME=e2b|webcontainer (default e2b intent). */
export function preferredSandboxRuntime(): 'e2b' | 'webcontainer' {
  const raw = (import.meta.env.VITE_SANDBOX_RUNTIME as string | undefined)?.toLowerCase();
  if (raw === 'webcontainer') return 'webcontainer';
  return 'e2b';
}
