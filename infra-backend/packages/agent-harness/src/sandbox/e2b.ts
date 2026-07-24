/**
 * E2B SandboxRuntime — create, reconnect, mount files, preview.
 */
import type {
  SandboxFileEntry,
  SandboxRunResult,
  SandboxRuntime,
  SandboxRuntimeInfo,
} from './types.js';

type E2BSandbox = {
  sandboxId: string;
  files: {
    write: (path: string, content: string) => Promise<unknown>;
    read: (path: string) => Promise<string | Uint8Array>;
    list?: (path?: string) => Promise<Array<{ name: string; type?: string }>>;
  };
  commands: {
    run: (
      cmd: string,
      opts?: { cwd?: string; timeoutMs?: number },
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
  getHost?: (port: number) => string;
  kill: () => Promise<void>;
};

type E2BSandboxStatic = {
  create: (
    templateOrOpts?: string | Record<string, unknown>,
    opts?: Record<string, unknown>,
  ) => Promise<E2BSandbox>;
  connect: (
    sandboxId: string,
    opts?: Record<string, unknown>,
  ) => Promise<E2BSandbox>;
};

export type E2BSandboxRuntimeOpts = {
  apiKey: string;
  /** Optional E2B template id; default base template. */
  template?: string;
  workdir?: string;
  /** Reconnect to an existing sandbox instead of creating. */
  sandboxId?: string;
};

export class E2BSandboxRuntime implements SandboxRuntime {
  readonly kind = 'e2b' as const;
  private sandbox: E2BSandbox | null = null;
  private previewUrl: string | null = null;
  private readonly apiKey: string;
  private readonly template?: string;
  private readonly workdir: string;
  private readonly reconnectId?: string;

  constructor(opts: E2BSandboxRuntimeOpts) {
    this.apiKey = opts.apiKey;
    this.template = opts.template;
    this.workdir = opts.workdir ?? '/home/user/project';
    this.reconnectId = opts.sandboxId;
  }

  async boot(): Promise<void> {
    if (this.sandbox) return;
    const mod = await import('e2b');
    const Sandbox = mod.Sandbox as E2BSandboxStatic;
    const createOpts = {
      apiKey: this.apiKey,
      timeoutMs: 30 * 60 * 1000,
    };

    if (this.reconnectId) {
      this.sandbox = await Sandbox.connect(this.reconnectId, createOpts);
      this.refreshPreviewUrl(5173);
      return;
    }

    this.sandbox = this.template
      ? await Sandbox.create(this.template, createOpts)
      : await Sandbox.create(createOpts);
    await this.sandbox.commands.run(`mkdir -p ${shellQuote(this.workdir)}`, {
      timeoutMs: 30_000,
    });
  }

  private requireSandbox(): E2BSandbox {
    if (!this.sandbox) {
      throw new Error('E2B sandbox not booted — call boot() first');
    }
    return this.sandbox;
  }

  private abs(path: string): string {
    const cleaned = path.replace(/^\/+/, '');
    return `${this.workdir}/${cleaned}`;
  }

  private refreshPreviewUrl(port: number): void {
    const sbx = this.requireSandbox();
    if (typeof sbx.getHost === 'function') {
      this.previewUrl = `https://${sbx.getHost(port)}`;
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const sbx = this.requireSandbox();
    // Ensure parent dirs exist for nested paths
    const abs = this.abs(path);
    const parent = abs.includes('/') ? abs.slice(0, abs.lastIndexOf('/')) : null;
    if (parent) {
      await sbx.commands
        .run(`mkdir -p ${shellQuote(parent)}`, { timeoutMs: 15_000 })
        .catch(() => undefined);
    }
    await sbx.files.write(abs, content);
  }

  async editFile(path: string, oldStr: string, newStr: string): Promise<void> {
    const current = await this.readFile(path);
    if (!current.includes(oldStr)) {
      throw new Error(`edit_file: old_str not found in ${path}`);
    }
    await this.writeFile(path, current.replace(oldStr, newStr));
  }

  async readFile(path: string): Promise<string> {
    const sbx = this.requireSandbox();
    const raw = await sbx.files.read(this.abs(path));
    if (typeof raw === 'string') return raw;
    return new TextDecoder().decode(raw);
  }

  async runTerminal(
    cmd: string,
    opts?: { cwd?: string },
  ): Promise<SandboxRunResult> {
    const sbx = this.requireSandbox();
    const cwd = opts?.cwd ? this.abs(opts.cwd) : this.workdir;
    try {
      const result = await sbx.commands.run(cmd, {
        cwd,
        timeoutMs: 180_000,
      });
      return {
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, exitCode: 1, stdout: '', stderr: message };
    }
  }

  async mountFiles(files: SandboxFileEntry[]): Promise<void> {
    for (const file of files) {
      await this.writeFile(file.path, file.content);
    }
  }

  /** Install deps then start Vite; returns preview URL. */
  async installAndStartPreview(opts?: {
    port?: number;
  }): Promise<string> {
    const port = opts?.port ?? 5173;
    const install = await this.runTerminal('npm install');
    if (!install.ok) {
      throw new Error(
        `npm install failed: ${install.stderr || install.stdout || 'unknown'}`,
      );
    }
    return this.startPreview({ port });
  }

  /** Refresh preview host URL from the connected sandbox (no process spawn). */
  refreshHost(port = 5173): string | null {
    if (!this.sandbox) return this.previewUrl;
    this.refreshPreviewUrl(port);
    return this.previewUrl;
  }

  async startPreview(opts?: { port?: number; cmd?: string }): Promise<string> {
    const port = opts?.port ?? 5173;
    const cmd =
      opts?.cmd ??
      `npm run dev -- --host 0.0.0.0 --port ${port}`;
    const sbx = this.requireSandbox();

    // Fire-and-forget Vite; E2B exposes getHost immediately.
    void sbx.commands.run(cmd, { cwd: this.workdir }).catch(() => undefined);

    this.refreshPreviewUrl(port);
    if (!this.previewUrl) {
      throw new Error('E2B sandbox did not expose a preview host URL');
    }
    return this.previewUrl;
  }

  async listFiles(root = ''): Promise<string[]> {
    const sbx = this.requireSandbox();
    if (!sbx.files.list) {
      const result = await this.runTerminal(
        `find ${shellQuote(this.abs(root || '.'))} -type f | head -n 500`,
      );
      return result.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((p) => p.replace(`${this.workdir}/`, ''));
    }
    const entries = await sbx.files.list(this.abs(root || '.'));
    return entries.map((e) => e.name);
  }

  getInfo(): SandboxRuntimeInfo {
    return {
      runtime: 'e2b',
      sandboxId: this.sandbox?.sandboxId ?? null,
      previewUrl: this.previewUrl,
    };
  }

  async dispose(): Promise<void> {
    if (!this.sandbox) return;
    try {
      await this.sandbox.kill();
    } finally {
      this.sandbox = null;
      this.previewUrl = null;
    }
  }
}

export async function mountFiles(
  runtime: SandboxRuntime,
  files: SandboxFileEntry[],
): Promise<void> {
  if (runtime instanceof E2BSandboxRuntime) {
    await runtime.mountFiles(files);
    return;
  }
  for (const file of files) {
    await runtime.writeFile(file.path, file.content);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
