/**
 * Built-in Tier-1 CriticGate checks (deterministic floor).
 */
import { inspectGeneratedContent } from '../untrusted-content.js';
import type { CriticCheck, CriticFinding } from './types.js';

const CODE_EXT = /\.(tsx?|jsx?|mts|cts)$/i;

/** Map output red-flag rules to severity — credentials/eval block; others warn. */
const RED_FLAG_SEVERITY: Record<string, 'error' | 'warning'> = {
  'dangerous-html': 'error',
  'dynamic-eval': 'error',
  'remote-script-src': 'error',
  'embedded-credential': 'error',
  'env-exfiltration': 'error',
  'inline-script': 'error',
};

/**
 * Wrap existing `inspectGeneratedContent` heuristics as an enforcing check.
 */
export function createOutputRedFlagCheck(opts?: {
  id?: string;
  /** Override severity by rule name. */
  severityByRule?: Record<string, 'error' | 'warning'>;
}): CriticCheck {
  const severity = { ...RED_FLAG_SEVERITY, ...opts?.severityByRule };
  return {
    id: opts?.id ?? 'output.red_flags',
    tier: 1,
    run: (ctx) => {
      const findings: CriticFinding[] = [];
      for (const art of ctx.artifacts) {
        for (const flag of inspectGeneratedContent(art.path, art.content)) {
          findings.push({
            checkId: opts?.id ?? 'output.red_flags',
            rule: flag.rule,
            severity: severity[flag.rule] ?? 'warning',
            message: `Generated content matched red-flag rule "${flag.rule}"`,
            path: flag.path,
            excerpt: flag.excerpt,
          });
        }
      }
      return findings;
    },
  };
}

/**
 * Forbid import path prefixes (e.g. `@/`) unless explicitly allowed.
 *
 * Quality scenario #4: when `@/` is not the declared house-style alias, block
 * so consumer typecheck never sees an undeclared alias.
 */
export function createForbiddenImportCheck(opts: {
  id?: string;
  /** Substrings / prefixes forbidden in import/require paths. */
  forbidden: string[];
  /** Prefixes that are allowed (e.g. house style `import.alias = '@/'`). */
  allowed?: string[];
}): CriticCheck {
  const forbidden = opts.forbidden.filter(Boolean);
  const allowed = new Set((opts.allowed ?? []).filter(Boolean));
  const id = opts.id ?? 'imports.forbidden';

  return {
    id,
    tier: 1,
    run: (ctx) => {
      const findings: CriticFinding[] = [];
      const importRe =
        /(?:from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

      for (const art of ctx.artifacts) {
        if (!CODE_EXT.test(art.path)) continue;
        let m: RegExpExecArray | null;
        const re = new RegExp(importRe.source, 'g');
        while ((m = re.exec(art.content))) {
          const spec = m[1] ?? m[2] ?? m[3] ?? '';
          for (const bad of forbidden) {
            if (!spec.includes(bad)) continue;
            // House style may declare the same prefix as allowed (e.g. `@/`).
            if (allowed.has(bad)) continue;
            findings.push({
              checkId: id,
              rule: 'forbidden_import',
              severity: 'error',
              message: `Forbidden import prefix "${bad}" in ${spec}`,
              path: art.path,
              excerpt: m[0].slice(0, 120),
            });
          }
        }
      }
      return findings;
    },
  };
}

/**
 * Minimal JSON object schema check — required keys + optional typeof guards.
 * No ajv dependency; enough for tool-call / structured draft floors.
 */
export function createJsonObjectSchemaCheck(opts: {
  id?: string;
  required?: string[];
  properties?: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array'>;
}): CriticCheck {
  const id = opts.id ?? 'schema.json_object';
  return {
    id,
    tier: 1,
    run: (ctx) => {
      const findings: CriticFinding[] = [];
      const data = ctx.data;
      if (data === undefined) {
        findings.push({
          checkId: id,
          rule: 'schema_missing_data',
          severity: 'error',
          message: 'CriticGate schema check requires ctx.data',
        });
        return findings;
      }
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        findings.push({
          checkId: id,
          rule: 'schema_not_object',
          severity: 'error',
          message: 'Expected a JSON object',
        });
        return findings;
      }
      const obj = data as Record<string, unknown>;
      for (const key of opts.required ?? []) {
        if (!(key in obj) || obj[key] === undefined || obj[key] === null) {
          findings.push({
            checkId: id,
            rule: 'schema_required',
            severity: 'error',
            message: `Missing required field "${key}"`,
          });
        }
      }
      for (const [key, expect] of Object.entries(opts.properties ?? {})) {
        if (!(key in obj) || obj[key] === undefined) continue;
        const v = obj[key];
        const ok =
          expect === 'array'
            ? Array.isArray(v)
            : expect === 'object'
              ? v !== null && typeof v === 'object' && !Array.isArray(v)
              : typeof v === expect;
        if (!ok) {
          findings.push({
            checkId: id,
            rule: 'schema_type',
            severity: 'error',
            message: `Field "${key}" expected ${expect}`,
            excerpt: String(v).slice(0, 80),
          });
        }
      }
      return findings;
    },
  };
}

/** Require at least N artifacts (blocks empty drafts). */
export function createMinArtifactsCheck(opts?: {
  id?: string;
  min?: number;
}): CriticCheck {
  const min = opts?.min ?? 1;
  const id = opts?.id ?? 'artifacts.min_count';
  return {
    id,
    tier: 1,
    run: (ctx) => {
      if (ctx.artifacts.length >= min) return [];
      return [
        {
          checkId: id,
          rule: 'too_few_artifacts',
          severity: 'error',
          message: `Expected at least ${min} artifact(s); got ${ctx.artifacts.length}`,
        },
      ];
    },
  };
}

/**
 * Default publish CriticGate floor: red flags + forbidden `@/` unless allowed.
 */
export function defaultPublishCriticChecks(opts?: {
  /** When house style declares `import.alias = '@/'`, pass `@/` here. */
  allowedImportPrefixes?: string[];
}): CriticCheck[] {
  return [
    createMinArtifactsCheck({ min: 1 }),
    createOutputRedFlagCheck(),
    createForbiddenImportCheck({
      forbidden: ['@/'],
      allowed: opts?.allowedImportPrefixes ?? [],
    }),
  ];
}
