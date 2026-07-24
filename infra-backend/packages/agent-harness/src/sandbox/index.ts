import type { CreateSandboxRuntimeOpts, SandboxRuntime } from './types.js';
import { E2BSandboxRuntime } from './e2b.js';

/**
 * Factory — E2B is the locked primary runtime.
 * Pass sandboxId to reconnect to a persisted sandbox.
 */
export async function createSandboxRuntime(
  opts: CreateSandboxRuntimeOpts = {},
): Promise<SandboxRuntime> {
  const prefer = opts.prefer ?? 'e2b';
  const apiKey =
    opts.e2bApiKey ??
    process.env.E2B_API_KEY ??
    process.env.e2b_api_key ??
    '';

  if (prefer === 'e2b') {
    if (!apiKey) {
      throw new Error(
        'E2B_API_KEY is required (SandboxRuntime primary = E2B). Set Secrets Manager / env.',
      );
    }
    const runtime = new E2BSandboxRuntime({
      apiKey,
      sandboxId: opts.sandboxId,
    });
    await runtime.boot();
    return runtime;
  }

  if (opts.allowWebContainerFallback) {
    throw new Error(
      'WebContainer fallback must be constructed on the client; use web/src/sandbox instead.',
    );
  }

  throw new Error(`Unsupported sandbox prefer=${prefer}`);
}

export type {
  SandboxRuntime,
  SandboxRunResult,
  SandboxRuntimeInfo,
  SandboxFileEntry,
} from './types.js';
export { E2BSandboxRuntime, mountFiles } from './e2b.js';
export { buildTemplateFiles } from './templates.js';
