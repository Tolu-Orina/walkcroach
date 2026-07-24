/**
 * Autonomy + infra hard gates (FR-D05).
 * Low-friction auto-approves routine local work; critical/infra always gated.
 */

export type AutonomyLevel = 'strict' | 'low_friction';

const INFRA_CMD =
  /\b(ccloud|terraform|pulumi|kubectl|helm|aws\s+cloudformation|drop\s+database|rm\s+-rf\b|format\s+c:)/i;

/** Destructive / privileged / irreversible — always require approval. */
const CRITICAL_CMD =
  /\b(sudo\b|doas\b|rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force).*|del\s+\/[sSfF]|rd\s+\/s|rmdir\s+\/s|format\s+|diskpart\b|mkfs\b|dd\s+if=|shutdown\b|reboot\b|git\s+push\s+[^\n]*--force|git\s+reset\s+--hard|Invoke-Expression\b|\biex\s*\(|curl\b[^\n|]*\|\s*(ba)?sh\b|wget\b[^\n|]*\|\s*(ba)?sh\b|chmod\s+-R\s+777|chown\s+-R\s+)/i;

const SENSITIVE_PATH =
  /(^|\/|\\)(\.env|\.env\..+|credentials|\.aws|\.ssh|id_rsa|package-lock\.json)(\/|\\|$)/i;

export function isInfraCommand(cmd: string): boolean {
  return INFRA_CMD.test(cmd);
}

export function isCriticalCommand(cmd: string): boolean {
  return isInfraCommand(cmd) || CRITICAL_CMD.test(cmd);
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

/** apply_patch: every hunk must be low-friction eligible. */
export function isLowFrictionPatchEligible(
  input: Record<string, unknown>,
): boolean {
  const path = String(input.path ?? '');
  if (!path || isSensitivePath(path)) return false;
  const edits = input.edits;
  if (!Array.isArray(edits) || edits.length === 0) return false;
  for (const row of edits) {
    if (!row || typeof row !== 'object') return false;
    const e = row as Record<string, unknown>;
    if (
      !isLowFrictionEditEligible({
        path,
        old_str: String(e.old_str ?? ''),
        new_str: String(e.new_str ?? ''),
      })
    ) {
      return false;
    }
  }
  return true;
}

export function shouldAutoApprove(params: {
  autonomy: AutonomyLevel;
  toolName: string;
  input: Record<string, unknown>;
}): boolean {
  if (params.autonomy !== 'low_friction') return false;

  // Cloud / MCP / subagents / memory mirror — always gated.
  if (params.toolName === 'ccloud') return false;
  if (params.toolName === 'cockroach_mcp') return false;
  if (params.toolName === 'spawn_subagent') return false;
  if (params.toolName === 'mirror_project_memory') return false;

  if (params.toolName === 'run_terminal') {
    const cmd = String(params.input.cmd ?? '').trim();
    if (!cmd) return false;
    // Only critical/infra shell needs a click.
    return !isCriticalCommand(cmd);
  }

  if (params.toolName === 'terminal_session') {
    // confirmCommand only fires for start; action may be omitted in the gate input.
    const action = String(params.input.action ?? 'start').toLowerCase();
    if (action !== 'start') return true;
    const cmd = String(params.input.cmd ?? '').trim();
    if (!cmd) return false;
    return !isCriticalCommand(cmd);
  }

  if (params.toolName === 'write_file' || params.toolName === 'update_walkcroach_md') {
    const path = String(params.input.path ?? '');
    if (!path || isSensitivePath(path)) return false;
    return true;
  }

  if (params.toolName === 'edit_file') {
    const path = String(params.input.path ?? '');
    const old_str = String(params.input.old_str ?? '');
    const new_str = String(params.input.new_str ?? '');
    return isLowFrictionEditEligible({ path, old_str, new_str });
  }

  if (params.toolName === 'apply_patch') {
    return isLowFrictionPatchEligible(params.input);
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
  if (toolName === 'terminal_session') return false;

  if (toolName === 'edit_file') {
    const path = String(input.path ?? '');
    const old_str = String(input.old_str ?? '');
    const new_str = String(input.new_str ?? '');
    return isLowFrictionEditEligible({ path, old_str, new_str });
  }

  if (toolName === 'apply_patch') {
    return isLowFrictionPatchEligible(input);
  }

  if (toolName === 'write_file' || toolName === 'update_walkcroach_md') {
    const path = String(input.path ?? '');
    if (path && isSensitivePath(path)) return false;
    return true;
  }

  return false;
}
