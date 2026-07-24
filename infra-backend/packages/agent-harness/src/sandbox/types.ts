/**
 * SandboxRuntime — runtime-agnostic builder execution surface.
 * Primary implementation: E2B (locked Jul 24, 2026). WebContainer is legacy.
 */

export type SandboxRunResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type SandboxFileEntry = {
  path: string;
  content: string;
};

export type SandboxRuntimeInfo = {
  runtime: 'e2b' | 'webcontainer' | 'none';
  sandboxId: string | null;
  previewUrl: string | null;
};

export interface SandboxRuntime {
  readonly kind: SandboxRuntimeInfo['runtime'];
  boot(opts?: { templateId?: string; cwd?: string }): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  editFile(path: string, oldStr: string, newStr: string): Promise<void>;
  readFile(path: string): Promise<string>;
  runTerminal(cmd: string, opts?: { cwd?: string }): Promise<SandboxRunResult>;
  startPreview(opts?: { port?: number; cmd?: string }): Promise<string>;
  listFiles(root?: string): Promise<string[]>;
  getInfo(): SandboxRuntimeInfo;
  dispose(): Promise<void>;
}

export type CreateSandboxRuntimeOpts = {
  /** Prefer e2b when API key present; fall back only if explicitly allowed. */
  prefer?: 'e2b' | 'webcontainer';
  e2bApiKey?: string;
  allowWebContainerFallback?: boolean;
  /** Reconnect to a persisted E2B sandbox id. */
  sandboxId?: string;
};
