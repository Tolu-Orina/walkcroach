import type { AgentEvent, ApprovalRequest } from '@walkcroach/agent-engine';
import { redact, redactString } from './redact.js';
import { errorToStructured, type ErrorCode } from './exit-codes.js';

export type OutputMode = 'tui' | 'text' | 'json';

export type JsonEnvelope =
  | { type: 'event'; event: AgentEvent }
  | {
      type: 'result';
      ok: boolean;
      reason?: string;
      /** Human-readable failure. Unchanged shape — scripts already read it. */
      error?: string;
      /** Stable machine-readable cause (C5.5). Added, never renamed. */
      code?: ErrorCode;
      /** One actionable sentence, when there is one. */
      hint?: string;
    }
  | { type: 'command'; name: string; data: unknown };

export class OutputSink {
  constructor(readonly mode: OutputMode) {}

  event(event: AgentEvent): void {
    if (this.mode === 'json') {
      // Same rule as the text path: scrub error events, pass everything else
      // through untouched so streamed content stays byte-for-byte intact.
      this.writeJson({
        type: 'event',
        event: event.type === 'error' ? (redact(event) as AgentEvent) : event,
      });
      return;
    }
    if (this.mode === 'text') {
      this.writeTextEvent(event);
    }
    // TUI consumes events via React state — host still emits for listeners
  }

  result(
    ok: boolean,
    extra?: { reason?: string; error?: string; code?: ErrorCode; hint?: string },
  ): void {
    const safe = extra?.error
      ? { ...extra, error: redactString(extra.error) }
      : extra;
    if (this.mode === 'json') {
      this.writeJson({ type: 'result', ok, ...safe });
      return;
    }
    if (!ok && safe?.error) {
      // Message first, hint on its own line. One dense line is exactly the
      // signal-to-noise problem clig.dev warns about, and it lands when
      // someone is already looking at a failure.
      process.stderr.write(`${safe.error}\n`);
      // Suppress a hint the message already gives. `AuthRequiredError` names
      // the fix in its own text, so printing the hint too produced "Run:
      // walkcroach auth login" twice — noise at exactly the moment someone is
      // reading a failure. The JSON payload still carries both, because a
      // script wants the field regardless of the prose.
      if (safe.hint && !safe.error.includes(safe.hint)) {
        process.stderr.write(`${redactString(safe.hint)}\n`);
      }
    }
  }

  /**
   * Report a thrown value as a classified failure (C5.5).
   *
   * One place that turns an error into `{ error, code, hint }`, so every
   * command reports the same shape and no call site has to remember to.
   */
  failure(err: unknown): void {
    const { code, message, hint } = errorToStructured(err);
    this.result(false, { error: message, code, hint });
  }

  command(name: string, data: unknown): void {
    // Command payloads are the CLI describing its own state — config, health,
    // session — so they are exactly where a credential can escape into a
    // terminal or a CI log. See redact.ts for why the agent's own output is
    // deliberately left alone.
    const safe = redact(data);
    if (this.mode === 'json') {
      this.writeJson({ type: 'command', name, data: safe });
      return;
    }
    if (typeof safe === 'string') {
      process.stdout.write(`${safe}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(safe, null, 2)}\n`);
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
        if (event.hits?.length) {
          for (const h of event.hits.slice(0, 5)) {
            process.stderr.write(
              `      [${h.sourceSurface}] ${h.text.slice(0, 100)}\n`,
            );
          }
        }
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
        // Engine errors often quote the failing request, which can carry an
        // Authorization header. Token deltas above are left untouched on
        // purpose — that is the user's own generated content.
        process.stderr.write(`\n✗ ${redactString(event.message)}\n`);
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

export function resolveOutputMode(
  opts: {
    json?: boolean;
    noTui?: boolean;
    forceTui?: boolean;
  },
  env: NodeJS.ProcessEnv = process.env,
): OutputMode {
  if (opts.json) return 'json';
  if (opts.noTui) return 'text';
  if (opts.forceTui) return 'tui';
  // A dumb terminal cannot render the Ink UI's cursor movement, so it gets the
  // plain stream even on a TTY (clig.dev: no animations where they cannot work).
  if (env.TERM === 'dumb') return 'text';
  // Visual parity when interactive TTY; plain when piped/CI
  if (process.stdout.isTTY && process.stdin.isTTY) return 'tui';
  return 'text';
}
