/**
 * ccloud CLI runner (FR-D17–D19). Always approval-gated; never low-friction.
 */

import { spawn } from 'node:child_process';

export type CcloudRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Parsed JSON when -o json succeeded. */
  json: unknown | null;
};

export function plainCcloudError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/ENOENT|not found|ccloud/i.test(msg) && /spawn/i.test(msg)) {
    return 'ccloud CLI was not found on PATH. Install the CockroachDB Cloud CLI and ensure it is available in the extension host environment.';
  }
  if (/401|unauthorized|forbidden|api.?key/i.test(msg)) {
    return 'ccloud rejected credentials. Set a project-scoped service-account API key via WalkCroach: Configure CockroachDB (NFR-D05).';
  }
  return `ccloud error: ${msg}`;
}

/** Ensure `-o json` is present for deterministic agent parsing. */
export function ensureJsonOutput(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-o' || a === '--output') {
      i += 1; // skip value
      continue;
    }
    if (a.startsWith('-o=') || a.startsWith('--output=')) {
      continue;
    }
    out.push(a);
  }
  out.push('-o', 'json');
  return out;
}

/**
 * Discover available commands from `ccloud --help` (FR-D19).
 */
export async function ccloudHelp(
  opts?: { env?: NodeJS.ProcessEnv; signal?: AbortSignal },
): Promise<string> {
  const result = await runCcloud(['--help'], opts);
  return (result.stdout || result.stderr).trim() || '(no help output)';
}

export async function runCcloud(
  args: string[],
  opts?: {
    cwd?: string;
    apiKey?: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  },
): Promise<CcloudRunResult> {
  const finalArgs = ensureJsonOutput(args);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...opts?.env,
  };
  // Common ccloud / Cockroach Cloud env var names
  if (opts?.apiKey) {
    env.COCKROACH_API_KEY = opts.apiKey;
    env.CC_API_KEY = opts.apiKey;
  }

  return new Promise((resolve, reject) => {
    const child = spawn('ccloud', finalArgs, {
      cwd: opts?.cwd,
      env,
      shell: false,
      signal: opts?.signal,
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString('utf8');
    });
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
    });
    child.on('error', (err) => {
      reject(new Error(plainCcloudError(err)));
    });
    child.on('close', (code) => {
      let json: unknown | null = null;
      const trimmed = stdout.trim();
      if (trimmed) {
        try {
          json = JSON.parse(trimmed);
        } catch {
          // keep null — still return raw stdout
        }
      }
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        json,
      });
    });
  });
}

/** True if args look like provision/modify/delete infra (always hard-gated). */
export function isCcloudInfraAction(args: string[]): boolean {
  const joined = args.join(' ').toLowerCase();
  // Verbs only — "cluster list" / "cluster get" are not infra mutations.
  return /\b(create|delete|update|modify|destroy|provision|restore|backup|allow|deny)\b/.test(
    joined,
  );
}
