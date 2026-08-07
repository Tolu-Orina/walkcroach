/**
 * Uniform tool dispatch pipeline (P3.1):
 * validate schema → execute → observe.
 *
 * Permission/risk (approvals) stays on the host gate before mutation tools run;
 * this module owns input validation and post-execution observation so every tool
 * path emits the same structured telemetry — including early schema failures.
 */
import type { HostAdapter } from '../host.js';
import type { ParsedToolUse } from '../bedrock.js';
import type { TelemetrySink } from '../telemetry.js';
import { getToolDef } from './defs.js';

export type ToolDispatchResult = {
  toolUseId: string;
  content: string;
  status: 'success' | 'error' | 'rejected';
};

export type ToolDispatchOptions = {
  host: HostAdapter;
  tool: ParsedToolUse;
  telemetry?: TelemetrySink | null;
};

export type ToolInputValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Lightweight required-field check against ToolDef.inputSchema.
 * Deliberately not a full JSON Schema validator — unknown properties are fine;
 * missing required keys and unknown tool names are not.
 */
export function validateToolInput(
  name: string,
  input: Record<string, unknown>,
): ToolInputValidation {
  const def = getToolDef(name);
  if (!def) {
    return { ok: false, error: `Unknown tool: ${name}` };
  }
  const schema = def.inputSchema as {
    required?: unknown;
  };
  const required = Array.isArray(schema.required)
    ? schema.required.filter((k): k is string => typeof k === 'string')
    : [];
  for (const key of required) {
    const value = input[key];
    if (value === undefined || value === null) {
      return { ok: false, error: `Tool ${name} requires '${key}'` };
    }
    if (typeof value === 'string' && value.trim() === '') {
      return { ok: false, error: `Tool ${name} requires non-empty '${key}'` };
    }
  }
  return { ok: true };
}

export function observeToolResult(
  telemetry: TelemetrySink | null | undefined,
  name: string,
  result: ToolDispatchResult,
  startedMs: number,
): void {
  if (!telemetry) return;
  const latencyMs = Math.max(0, Date.now() - startedMs);
  telemetry.recordTool({
    name,
    status: result.status,
    latencyMs,
  });
}

/**
 * Wrap an implementer so every call goes through validate → execute → observe.
 */
export async function dispatchTool<TOpts extends ToolDispatchOptions>(
  opts: TOpts,
  executeBody: (opts: TOpts) => Promise<ToolDispatchResult>,
): Promise<ToolDispatchResult> {
  const started = Date.now();
  const name = opts.tool.name;
  const validation = validateToolInput(name, opts.tool.input ?? {});
  if (!validation.ok) {
    opts.host.emit({
      type: 'tool_card',
      id: opts.tool.toolUseId,
      name,
      status: 'error',
      detail: validation.error,
    });
    const result: ToolDispatchResult = {
      toolUseId: opts.tool.toolUseId,
      content: `Error: ${validation.error}`,
      status: 'error',
    };
    observeToolResult(opts.telemetry, name, result, started);
    return result;
  }

  const result = await executeBody(opts);
  observeToolResult(opts.telemetry, name, result, started);
  return result;
}
