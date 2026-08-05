/**
 * The slice of a sandbox this host needs.
 *
 * Declared structurally rather than imported from `@walkcroach/agent-harness`
 * on purpose: that package lives under `infra-backend` and pulls in the AWS SDK,
 * CockroachDB, and the whole Lambda-side world. This host only needs a
 * filesystem and a shell, and keeping the dependency at an interface means the
 * same adapter runs over a Lambda MicroVM, an AgentCore session, E2B, or an
 * in-memory fake in tests — without any of them being a build-time dependency.
 *
 * `agent-harness`'s `SandboxRuntime` satisfies this shape already.
 */
export type SandboxExec = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export interface SandboxLike {
  readonly kind: string;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  runTerminal(cmd: string, opts?: { cwd?: string }): Promise<SandboxExec>;
  listFiles(root?: string): Promise<string[]>;
  /** Optional: only sandboxes that expose an inbound endpoint implement this. */
  startPreview?(opts?: { port?: number; cmd?: string }): Promise<string>;
  dispose?(): Promise<void>;
}
