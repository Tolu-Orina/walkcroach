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
import { DEFAULT_MAX_INDEX_FILES } from './local-index.js';

export const SETTINGS_REL_PATH = `${WALK_CROACH_DIR}/settings.json`;
export const VERIFY_REL_PATH = `${WALK_CROACH_DIR}/verify.json`;
export const RULES_REL_DIR = `${WALK_CROACH_DIR}/rules`;
export const MCP_CONFIG_REL_PATH = `${WALK_CROACH_DIR}/mcp.json`;

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
  /** P3 — local semantic index (semantic_search tool). */
  index: {
    enabled: boolean;
    /** Cap on files considered when (re)building the index. */
    maxFiles: number;
  };
};

export type VerifyConfig = {
  commands: string[];
  cwd: string;
};

export type WorkspaceAgentConfig = {
  settings: WalkcroachSettings;
  verify: VerifyConfig;
  /** Concatenated always + glob-matched rules markdown (already truncated). */
  rulesMd: string;
  /** Relative rule file paths included in rulesMd (always + matched glob). */
  ruleFiles: string[];
  /** Manual / agent-requested / unmatched-glob rules — metadata only; load body via load_rule. */
  ruleCatalog: RuleCatalogEntry[];
};

export type RuleFrontmatter = {
  name?: string;
  description?: string;
  /** Auto-attach when the active file matches one of these patterns. */
  globs?: string[];
  /** Explicit true/false. Default (no frontmatter, or no globs/description) behaves as true. */
  alwaysApply?: boolean;
};

export type RuleCatalogEntry = {
  name: string;
  description: string;
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
    index: {
      enabled: true,
      maxFiles: DEFAULT_MAX_INDEX_FILES,
    },
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

  const index = o.index;
  if (index && typeof index === 'object') {
    const i = index as Record<string, unknown>;
    if (typeof i.enabled === 'boolean') base.index.enabled = i.enabled;
    if (typeof i.maxFiles === 'number' && Number.isFinite(i.maxFiles)) {
      base.index.maxFiles = Math.max(1, Math.min(20_000, Math.floor(i.maxFiles)));
    }
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

/** Same matcher, shared name for rule-file `globs:` scoping (denyPaths and rule globs use identical semantics). */
export const matchesGlob = matchesDenyPattern;

function matchFrontField(front: string, key: string): string | undefined {
  const lines = front.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(new RegExp(`^${key}:\\s*(.*)$`, 'i'));
    if (m) return (m[1] ?? '').trim();
  }
  return undefined;
}

function unquote(v: string): string {
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Minimal frontmatter parser for `.walkcroach/rules/*.md` — not general YAML,
 * just the three scalar/array fields rule files need (Cursor `.mdc`-equivalent).
 * No leading `---` block → treated as a legacy plain rule file (empty attrs).
 */
export function parseRuleFrontmatter(raw: string): {
  attrs: RuleFrontmatter;
  body: string;
} {
  const trimmed = raw.replace(/^﻿/, '');
  if (!trimmed.startsWith('---')) {
    return { attrs: {}, body: trimmed };
  }
  const end = trimmed.indexOf('\n---', 3);
  if (end < 0) return { attrs: {}, body: trimmed };
  const front = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 4).replace(/^\r?\n/, '');

  const attrs: RuleFrontmatter = {};
  const name = matchFrontField(front, 'name');
  if (name) attrs.name = unquote(name);
  const description = matchFrontField(front, 'description');
  if (description) attrs.description = unquote(description);
  const globsRaw = matchFrontField(front, 'globs');
  if (globsRaw) {
    const globs = globsRaw
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(',')
      .map((g) => unquote(g.trim()))
      .filter(Boolean);
    if (globs.length) attrs.globs = globs;
  }
  const alwaysApplyRaw = matchFrontField(front, 'alwaysApply');
  if (alwaysApplyRaw) {
    attrs.alwaysApply = /^true$/i.test(alwaysApplyRaw);
  }

  return { attrs, body };
}

function deriveRuleName(fileName: string, attrs: RuleFrontmatter): string {
  return attrs.name?.trim() || fileName.replace(/\.md$/i, '');
}

/** Cheap catalog text for the system prompt (mirrors SkillsRegistry.catalogText). */
export function formatRuleCatalog(entries: RuleCatalogEntry[]): string {
  if (!entries.length) return '';
  return entries.map((e) => `- ${e.name}: ${e.description}`).join('\n');
}

export async function loadWorkspaceAgentConfig(
  workspaceRoot: string | undefined,
  opts?: { activeFile?: string },
): Promise<WorkspaceAgentConfig> {
  const settings = defaultSettings();
  const verify: VerifyConfig = { commands: [], cwd: '.' };
  let rulesMd = '';
  const ruleFiles: string[] = [];
  const ruleCatalog: RuleCatalogEntry[] = [];

  if (!workspaceRoot) {
    return { settings, verify, rulesMd, ruleFiles, ruleCatalog };
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

    const activeFile = opts?.activeFile;
    /** always-applied + glob-matched files, in file-sort order — candidates for the truncated rulesMd block. */
    const included: Array<{ file: string; body: string }> = [];

    for (const name of mdFiles) {
      let raw: string;
      try {
        raw = await readFile(join(rulesDir, name), 'utf8');
      } catch {
        continue; // skip unreadable
      }
      const { attrs, body } = parseRuleFrontmatter(raw);
      const relPath = `${RULES_REL_DIR}/${name}`.replace(/\\/g, '/');
      const hasGlobs = Array.isArray(attrs.globs) && attrs.globs.length > 0;
      const hasDescription = Boolean(attrs.description?.trim());

      /**
       * Mode resolution (Cursor `.mdc`-equivalent):
       * - alwaysApply: true always wins, regardless of globs/description.
       * - Else globs present → glob-scoped (auto-attach only when activeFile matches).
       * - Else a description with no globs and no explicit alwaysApply:true → manual/agent-requested
       *   (catalog only, full body via load_rule).
       * - Else (no frontmatter, or frontmatter with none of the above) → always, matching the
       *   pre-frontmatter behavior so plain legacy rule files are unaffected.
       */
      let mode: 'always' | 'glob' | 'manual';
      if (attrs.alwaysApply === true) {
        mode = 'always';
      } else if (hasGlobs) {
        mode = 'glob';
      } else if (hasDescription) {
        mode = 'manual';
      } else {
        mode = 'always';
      }

      const globMatched =
        mode === 'glob' &&
        Boolean(activeFile && attrs.globs!.some((g) => matchesGlob(activeFile, g)));

      if (mode === 'always' || globMatched) {
        included.push({ file: relPath, body });
      } else {
        ruleCatalog.push({
          name: deriveRuleName(name, attrs),
          description:
            attrs.description?.trim() ||
            (hasGlobs
              ? `Applies to files matching: ${attrs.globs!.join(', ')}`
              : `Rule from ${relPath}`),
        });
      }
    }

    const chunks: string[] = [];
    let used = 0;
    for (const { file, body } of included) {
      if (used >= MAX_RULES_CHARS) break;
      const slice = body.slice(0, MAX_RULES_CHARS - used);
      chunks.push(`## ${file}\n\n${slice.trim()}`);
      used += slice.length;
      ruleFiles.push(file);
    }
    rulesMd = chunks.join('\n\n').trim();
  } catch {
    /* no rules dir */
  }

  return { settings, verify, rulesMd, ruleFiles, ruleCatalog };
}

/** On-demand full body for a manual/agent-requested rule (load_rule tool). */
export async function loadRuleBody(
  workspaceRoot: string | undefined,
  name: string,
): Promise<{ name: string; description?: string; body: string } | null> {
  if (!workspaceRoot) return null;
  const rulesDir = join(workspaceRoot, RULES_REL_DIR);
  let entries;
  try {
    entries = await readdir(rulesDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const mdFiles = entries.filter((e) => e.isFile() && /\.md$/i.test(e.name));
  for (const e of mdFiles) {
    let raw: string;
    try {
      raw = await readFile(join(rulesDir, e.name), 'utf8');
    } catch {
      continue;
    }
    const { attrs, body } = parseRuleFrontmatter(raw);
    const ruleName = deriveRuleName(e.name, attrs);
    if (ruleName === name) {
      return { name: ruleName, description: attrs.description, body };
    }
  }
  return null;
}

/** One entry from `.walkcroach/mcp.json`'s `mcpServers` map. */
export type McpServerFileConfig = {
  url: string;
  headers?: Record<string, string>;
};

/** Interpolates `${env:VAR_NAME}` in header values so secrets stay out of the committed file. */
function interpolateEnvVars(value: string): string {
  return value.replace(
    /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_match, varName: string) => process.env[varName] ?? '',
  );
}

/**
 * Parse the `{ mcpServers: { name: { url, headers } } }` shape (Cursor's `.cursor/mcp.json`
 * format). Unknown/malformed entries are skipped rather than throwing — a typo in one
 * server should not break the whole config.
 */
export function parseMcpServersJson(
  raw: unknown,
): Record<string, McpServerFileConfig> {
  const out: Record<string, McpServerFileConfig> = {};
  if (!raw || typeof raw !== 'object') return out;
  const servers = (raw as Record<string, unknown>).mcpServers;
  if (!servers || typeof servers !== 'object') return out;

  for (const [name, value] of Object.entries(servers as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    if (typeof v.url !== 'string' || !v.url.trim()) continue;

    const headers: Record<string, string> = {};
    if (v.headers && typeof v.headers === 'object') {
      for (const [hk, hv] of Object.entries(v.headers as Record<string, unknown>)) {
        if (typeof hv === 'string') headers[hk] = interpolateEnvVars(hv);
      }
    }

    out[name] = {
      url: v.url.trim(),
      ...(Object.keys(headers).length ? { headers } : {}),
    };
  }

  return out;
}

/** Loads and parses `.walkcroach/mcp.json`; missing/invalid file → no additional servers. */
export async function loadMcpServersConfig(
  workspaceRoot: string | undefined,
): Promise<Record<string, McpServerFileConfig>> {
  if (!workspaceRoot) return {};
  try {
    const raw = await readFile(join(workspaceRoot, MCP_CONFIG_REL_PATH), 'utf8');
    return parseMcpServersJson(JSON.parse(raw));
  } catch {
    return {};
  }
}
