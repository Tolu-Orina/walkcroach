/**
 * Load `.walkcroach/settings.json`, `verify.json`, and `rules/*.md`.
 * Additive to WALKCROACH.md — local agent mechanics (Claude `.claude/` pattern).
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AutonomyLevel } from './approvals.js';
import { WALK_CROACH_DIR } from './session-fs.js';
import {
  defaultHooksConfig,
  parseHooksConfig,
  type HooksConfig,
} from './hooks.js';

export const SETTINGS_REL_PATH = `${WALK_CROACH_DIR}/settings.json`;
export const VERIFY_REL_PATH = `${WALK_CROACH_DIR}/verify.json`;
export const RULES_REL_DIR = `${WALK_CROACH_DIR}/rules`;

export const DEFAULT_TERMINAL_TIMEOUT_MS = 120_000;
export const MAX_RULES_CHARS = 24_000;
export const DEFAULT_MAX_SESSIONS = 20;

export type WalkcroachSettings = {
  autonomy?: AutonomyLevel;
  terminal: {
    defaultTimeoutMs: number;
    /** If non-empty, background mode is only allowed when cmd matches one entry (case-insensitive substring). */
    backgroundAllowlist: string[];
  };
  /** Extra path deny patterns (substring or simple glob with *). Always includes built-in sensitive paths. */
  denyPaths: string[];
  verify: {
    /** Soft-gate: nudge once before complete if action work lacked a successful verify. */
    required: boolean;
    maxNudges: number;
  };
  session: {
    /** Persist Bedrock turns under .walkcroach/sessions/ (default true). */
    persist: boolean;
    /** Max session directories to keep (oldest pruned). */
    maxSessions: number;
  };
  hooks: HooksConfig;
};

export type VerifyConfig = {
  commands: string[];
  cwd: string;
};

export type WorkspaceAgentConfig = {
  settings: WalkcroachSettings;
  verify: VerifyConfig;
  /** Concatenated rules markdown (already truncated). */
  rulesMd: string;
  /** Relative rule file paths loaded. */
  ruleFiles: string[];
};

export function defaultSettings(): WalkcroachSettings {
  return {
    terminal: {
      defaultTimeoutMs: DEFAULT_TERMINAL_TIMEOUT_MS,
      backgroundAllowlist: [],
    },
    denyPaths: [],
    verify: {
      required: true,
      maxNudges: 1,
    },
    session: {
      persist: true,
      maxSessions: DEFAULT_MAX_SESSIONS,
    },
    hooks: defaultHooksConfig(),
  };
}

export function parseSettingsJson(raw: unknown): WalkcroachSettings {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;

  if (o.autonomy === 'strict' || o.autonomy === 'low_friction') {
    base.autonomy = o.autonomy;
  }

  const term = o.terminal;
  if (term && typeof term === 'object') {
    const t = term as Record<string, unknown>;
    if (typeof t.defaultTimeoutMs === 'number' && Number.isFinite(t.defaultTimeoutMs)) {
      base.terminal.defaultTimeoutMs = Math.max(
        1_000,
        Math.min(600_000, Math.floor(t.defaultTimeoutMs)),
      );
    }
    if (Array.isArray(t.backgroundAllowlist)) {
      base.terminal.backgroundAllowlist = t.backgroundAllowlist
        .map((x) => String(x).trim())
        .filter(Boolean);
    }
  }

  if (Array.isArray(o.denyPaths)) {
    base.denyPaths = o.denyPaths.map((x) => String(x).trim()).filter(Boolean);
  }

  const verify = o.verify;
  if (verify && typeof verify === 'object') {
    const v = verify as Record<string, unknown>;
    if (typeof v.required === 'boolean') base.verify.required = v.required;
    if (typeof v.maxNudges === 'number' && Number.isFinite(v.maxNudges)) {
      base.verify.maxNudges = Math.max(0, Math.min(3, Math.floor(v.maxNudges)));
    }
  }

  const session = o.session;
  if (session && typeof session === 'object') {
    const s = session as Record<string, unknown>;
    if (typeof s.persist === 'boolean') base.session.persist = s.persist;
    if (typeof s.maxSessions === 'number' && Number.isFinite(s.maxSessions)) {
      base.session.maxSessions = Math.max(
        1,
        Math.min(100, Math.floor(s.maxSessions)),
      );
    }
  }

  // Hooks live under settings.hooks (Claude-compatible nesting).
  if (o.hooks !== undefined) {
    base.hooks = parseHooksConfig({ hooks: o.hooks });
  }

  return base;
}

/**
 * Accepts:
 * - `["npm test", "npm run typecheck"]`
 * - `{ "commands": [...], "cwd": "." }`
 */
export function parseVerifyJson(raw: unknown): VerifyConfig {
  if (Array.isArray(raw)) {
    return {
      commands: raw.map((x) => String(x).trim()).filter(Boolean).slice(0, 20),
      cwd: '.',
    };
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const commands = Array.isArray(o.commands)
      ? o.commands.map((x) => String(x).trim()).filter(Boolean).slice(0, 20)
      : [];
    const cwd =
      typeof o.cwd === 'string' && o.cwd.trim() ? o.cwd.trim() : '.';
    return { commands, cwd };
  }
  return { commands: [], cwd: '.' };
}

export function normalizeCmdKey(cmd: string): string {
  return cmd.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isVerifyCommand(
  cmd: string,
  verify: VerifyConfig,
): boolean {
  const key = normalizeCmdKey(cmd);
  return verify.commands.some((c) => normalizeCmdKey(c) === key);
}

export function isBackgroundAllowed(
  cmd: string,
  allowlist: string[],
): boolean {
  if (!allowlist.length) return true;
  const lower = cmd.toLowerCase();
  return allowlist.some((entry) => lower.includes(entry.toLowerCase()));
}

/** Substring or simple `*` glob against normalized path. */
export function matchesDenyPattern(path: string, pattern: string): boolean {
  const p = path.replace(/\\/g, '/').toLowerCase();
  const pat = pattern.replace(/\\/g, '/').toLowerCase().trim();
  if (!pat) return false;
  if (!pat.includes('*')) {
    return p === pat || p.endsWith(`/${pat}`) || p.includes(`/${pat}/`);
  }
  const reSrc = pat
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DS::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DS::/g, '.*');
  return new RegExp(`(^|/)${reSrc}(/|$)`).test(p) || new RegExp(`^${reSrc}$`).test(p);
}

export async function loadWorkspaceAgentConfig(
  workspaceRoot: string | undefined,
): Promise<WorkspaceAgentConfig> {
  const settings = defaultSettings();
  const verify: VerifyConfig = { commands: [], cwd: '.' };
  let rulesMd = '';
  const ruleFiles: string[] = [];

  if (!workspaceRoot) {
    return { settings, verify, rulesMd, ruleFiles };
  }

  try {
    const raw = await readFile(join(workspaceRoot, SETTINGS_REL_PATH), 'utf8');
    Object.assign(settings, parseSettingsJson(JSON.parse(raw)));
  } catch {
    /* missing / invalid → defaults */
  }

  try {
    const raw = await readFile(join(workspaceRoot, VERIFY_REL_PATH), 'utf8');
    const parsed = parseVerifyJson(JSON.parse(raw));
    verify.commands = parsed.commands;
    verify.cwd = parsed.cwd;
  } catch {
    /* missing */
  }

  try {
    const rulesDir = join(workspaceRoot, RULES_REL_DIR);
    const entries = await readdir(rulesDir, { withFileTypes: true });
    const mdFiles = entries
      .filter((e) => e.isFile() && /\.md$/i.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    const chunks: string[] = [];
    let used = 0;
    for (const name of mdFiles) {
      if (used >= MAX_RULES_CHARS) break;
      try {
        const body = await readFile(join(rulesDir, name), 'utf8');
        const slice = body.slice(0, MAX_RULES_CHARS - used);
        chunks.push(`## ${name}\n\n${slice.trim()}`);
        used += slice.length;
        ruleFiles.push(`${RULES_REL_DIR}/${name}`.replace(/\\/g, '/'));
      } catch {
        /* skip unreadable */
      }
    }
    rulesMd = chunks.join('\n\n').trim();
  } catch {
    /* no rules dir */
  }

  return { settings, verify, rulesMd, ruleFiles };
}
