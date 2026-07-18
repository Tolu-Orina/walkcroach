/**
 * Autonomy + infra hard gates (FR-D05).
 * Low-friction may auto-approve narrow edit_file only — never terminal/infra.
 */

export type AutonomyLevel = 'strict' | 'low_friction';

const INFRA_CMD =
  /\b(ccloud|terraform|pulumi|kubectl|helm|aws\s+cloudformation|drop\s+database|rm\s+-rf\b|format\s+c:)/i;

const SENSITIVE_PATH =
  /(^|\/|\\)(\.env|\.env\..+|credentials|\.aws|\.ssh|id_rsa|package-lock\.json)(\/|\\|$)/i;

export function isInfraCommand(cmd: string): boolean {
  return INFRA_CMD.test(cmd);
}

export function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATH.test(path.replace(/\\/g, '/'));
}

/** Narrow edit eligible for low-friction auto-approve. */
export function isLowFrictionEditEligible(input: {
  path: string;
  old_str: string;
  new_str: string;
}): boolean {
  if (isSensitivePath(input.path)) return false;
  if (input.old_str.length > 2000 || input.new_str.length > 2000) return false;
  if (!input.old_str) return false;
  return true;
}

export function shouldAutoApprove(params: {
  autonomy: AutonomyLevel;
  toolName: string;
  input: Record<string, unknown>;
}): boolean {
  if (params.autonomy !== 'low_friction') return false;
  if (params.toolName === 'run_terminal') return false;
  if (params.toolName === 'write_file') return false;
  if (params.toolName === 'update_walkcroach_md') return false;
  if (params.toolName === 'spawn_subagent') return false;
  if (params.toolName === 'ccloud') return false;
  if (params.toolName === 'cockroach_mcp') return false;
  if (params.toolName === 'mirror_project_memory') return false;
  if (params.toolName === 'edit_file') {
    const path = String(params.input.path ?? '');
    const old_str = String(params.input.old_str ?? '');
    const new_str = String(params.input.new_str ?? '');
    return isLowFrictionEditEligible({ path, old_str, new_str });
  }
  return false;
}

/**
 * CI / `--yes` / `--non-interactive` (FR-D25): auto-approve only safe local tools.
 * Never auto-approves ccloud, MCP writes, shell, or infra.
 * Shell is deny-by-default in non-interactive mode (too easy to bypass INFRA_CMD).
 */
export function canNonInteractiveApprove(params: {
  toolName: string;
  input: Record<string, unknown>;
  /** Preformatted command preview when tool is run_terminal / ccloud / mcp write. */
  cmdPreview?: string;
}): boolean {
  const { toolName, input } = params;
  if (toolName === 'ccloud') return false;
  if (toolName === 'cockroach_mcp') return false;
  if (toolName === 'mirror_project_memory') return false;
  if (toolName === 'spawn_subagent') return false;
  if (toolName === 'run_terminal') return false;

  if (toolName === 'edit_file') {
    const path = String(input.path ?? '');
    const old_str = String(input.old_str ?? '');
    const new_str = String(input.new_str ?? '');
    return isLowFrictionEditEligible({ path, old_str, new_str });
  }

  if (toolName === 'write_file' || toolName === 'update_walkcroach_md') {
    const path = String(input.path ?? '');
    if (path && isSensitivePath(path)) return false;
    return true;
  }

  return false;
}
