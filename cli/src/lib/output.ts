import type { AgentEvent, ApprovalRequest } from '@walkcroach/agent-engine';

export type OutputMode = 'tui' | 'text' | 'json';

export type JsonEnvelope =
  | { type: 'event'; event: AgentEvent }
  | { type: 'result'; ok: boolean; reason?: string; error?: string }
  | { type: 'command'; name: string; data: unknown };

export class OutputSink {
  constructor(readonly mode: OutputMode) {}

  event(event: AgentEvent): void {
    if (this.mode === 'json') {
      this.writeJson({ type: 'event', event });
      return;
    }
    if (this.mode === 'text') {
      this.writeTextEvent(event);
    }
    // TUI consumes events via React state — host still emits for listeners
  }

  result(ok: boolean, extra?: { reason?: string; error?: string }): void {
    if (this.mode === 'json') {
      this.writeJson({ type: 'result', ok, ...extra });
      return;
    }
    if (!ok && extra?.error) {
      process.stderr.write(`${extra.error}\n`);
    }
  }

  command(name: string, data: unknown): void {
    if (this.mode === 'json') {
      this.writeJson({ type: 'command', name, data });
      return;
    }
    if (typeof data === 'string') {
      process.stdout.write(`${data}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  }

  private writeJson(payload: JsonEnvelope): void {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }

  private writeTextEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'phase':
        process.stderr.write(`\n▸ phase: ${event.phase}\n`);
        return;
      case 'token_delta':
        process.stdout.write(event.text);
        return;
      case 'tool_card':
        process.stderr.write(
          `  · ${event.name} [${event.status}]${event.detail ? ` — ${event.detail}` : ''}\n`,
        );
        return;
      case 'approval_request':
        process.stderr.write(formatApprovalPreview(event.request));
        return;
      case 'subagent':
        process.stderr.write(
          `  ↳ subagent:${event.name} [${event.status}]${event.summary ? ` — ${event.summary}` : ''}\n`,
        );
        return;
      case 'done':
        process.stderr.write(`\n✓ done (${event.reason})\n`);
        return;
      case 'error':
        process.stderr.write(`\n✗ ${event.message}\n`);
        return;
      case 'cache_usage':
        process.stderr.write(
          `  cache read=${event.cacheReadInputTokens} write=${event.cacheWriteInputTokens}\n`,
        );
        return;
      case 'telemetry':
        return;
      default:
        return;
    }
  }
}

export function formatApprovalPreview(req: ApprovalRequest): string {
  const lines = [
    `\n── Approval required: ${req.toolName} (${req.kind}) ──`,
  ];
  if (req.path) lines.push(`path: ${req.path}`);
  if (req.kind === 'command' && req.cmd) {
    lines.push(`cmd:\n${req.cmd}`);
  } else {
    const before = (req.before ?? '').slice(0, 800);
    const after = (req.after ?? '').slice(0, 800);
    lines.push(`before:\n${before}`);
    lines.push(`after:\n${after}`);
  }
  lines.push('Approve? [y/N]');
  return `${lines.join('\n')}\n`;
}

export function resolveOutputMode(opts: {
  json?: boolean;
  noTui?: boolean;
  forceTui?: boolean;
}): OutputMode {
  if (opts.json) return 'json';
  if (opts.noTui) return 'text';
  if (opts.forceTui) return 'tui';
  // Visual parity when interactive TTY; plain when piped/CI
  if (process.stdout.isTTY && process.stdin.isTTY) return 'tui';
  return 'text';
}
