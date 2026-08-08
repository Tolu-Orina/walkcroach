/**
 * Phase 7 — real ModelCritic implementations (ADR-D cascade).
 *
 * Tier 1 remains the deterministic floor and always runs first.
 * Tier 2/3 run only when `enableModelCritic: true` (env or explicit inject).
 *
 * Default production path stays floor-only until an operator opts in with
 * evidence (eval escape rate / revise thrash) — see Phase 8 retrospective.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { getBedrockRegion, getNovaModelId } from '../bedrock.js';
import type {
  CriticArtifact,
  CriticFinding,
  ModelCritic,
  ModelCriticRequest,
  ModelCriticResult,
} from './types.js';

/** Soft cap on artifact chars sent to Tier 3 (cost observability). */
export const TIER3_MAX_ARTIFACT_CHARS = 24_000;
/** Soft cap on findings a single model call may add. */
export const TIER3_MAX_FINDINGS = 12;

const TODO_RE = /\b(TODO|FIXME|XXX)\b/;
const LOREM_RE = /lorem\s+ipsum/i;
const SCRIPT_RE = /<script[\s>]/i;
const EVAL_RE = /\beval\s*\(/;
const EMPTY_DEFAULT_RE =
  /export\s+default\s+function\s+\w+\s*\([^)]*\)\s*\{\s*return\s+null\s*;?\s*\}/;

/**
 * Tier 2 — cheap heuristic judge (no Bedrock).
 * Catches quality smells Tier 1 does not encode as hard rules.
 */
export function createTier2HeuristicModelCritic(
  id = 'critic.tier2.heuristic',
): ModelCritic {
  return {
    tier: 2,
    id,
    async critique(req: ModelCriticRequest): Promise<ModelCriticResult> {
      const findings: CriticFinding[] = [];
      for (const a of req.artifacts) {
        findings.push(...heuristicFindings(a, id));
      }
      return { findings, confidence: 0.7 };
    },
  };
}

function heuristicFindings(a: CriticArtifact, checkId: string): CriticFinding[] {
  const out: CriticFinding[] = [];
  const content = a.content ?? '';
  const path = a.path;

  if (TODO_RE.test(content)) {
    out.push({
      checkId,
      rule: 'unfinished_marker',
      severity: 'error',
      message: 'Draft still contains TODO/FIXME/XXX — finish or remove before publish',
      path,
      excerpt: content.match(TODO_RE)?.[0],
    });
  }
  if (LOREM_RE.test(content)) {
    out.push({
      checkId,
      rule: 'placeholder_copy',
      severity: 'error',
      message: 'Placeholder lorem ipsum must not ship',
      path,
    });
  }
  if (SCRIPT_RE.test(content)) {
    out.push({
      checkId,
      rule: 'inline_script',
      severity: 'error',
      message: 'Inline <script> is not allowed in published page modules',
      path,
    });
  }
  if (EVAL_RE.test(content)) {
    out.push({
      checkId,
      rule: 'dynamic_eval',
      severity: 'error',
      message: 'eval() is forbidden in published artifacts',
      path,
    });
  }
  if (EMPTY_DEFAULT_RE.test(content)) {
    out.push({
      checkId,
      rule: 'empty_page',
      severity: 'warning',
      message: 'Default export appears to return null — page may be empty',
      path,
    });
  }
  // Very short TSX/MD bodies are usually incomplete drafts.
  const body = content.replace(/\s+/g, ' ').trim();
  if (
    (path.endsWith('.tsx') || path.endsWith('.md') || path.endsWith('.mdx')) &&
    body.length > 0 &&
    body.length < 80
  ) {
    out.push({
      checkId,
      rule: 'thin_artifact',
      severity: 'warning',
      message: `Artifact is very short (${body.length} chars) — verify content was not truncated`,
      path,
    });
  }
  return out;
}

export type Tier3Invoke = (prompt: string) => Promise<string>;

/**
 * Tier 3 — LLM-as-judge via Bedrock Converse (or injected invoke for tests).
 *
 * Fail-soft on model/infra errors: returns empty findings so the Tier-1 floor
 * remains the hard gate (quality of the floor > availability of the judge).
 */
export function createTier3LlmModelCritic(opts?: {
  id?: string;
  invoke?: Tier3Invoke;
  modelId?: string;
}): ModelCritic {
  const id = opts?.id ?? 'critic.tier3.llm';
  const invoke = opts?.invoke ?? defaultBedrockInvoke(opts?.modelId);

  return {
    tier: 3,
    id,
    async critique(req: ModelCriticRequest): Promise<ModelCriticResult> {
      try {
        const prompt = buildTier3Prompt(req);
        const raw = await invoke(prompt);
        const findings = parseTier3Findings(raw, id).slice(0, TIER3_MAX_FINDINGS);
        return { findings, confidence: 0.55 };
      } catch {
        return { findings: [], confidence: 0 };
      }
    },
  };
}

function defaultBedrockInvoke(modelId?: string): Tier3Invoke {
  return async (prompt: string) => {
    const client = new BedrockRuntimeClient({ region: getBedrockRegion() });
    const res = await client.send(
      new ConverseCommand({
        modelId: modelId ?? getNovaModelId(),
        system: [
          {
            text:
              'You are CriticGate Tier 3. Return ONLY a JSON array of findings. ' +
              'Each item: { "rule": string, "severity": "error"|"warning", "message": string, "path"?: string }. ' +
              'Judge publish quality (correctness, completeness, security smells) beyond mechanical lint. ' +
              'Empty array if clean. No markdown fences.',
          },
        ],
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 1_200, temperature: 0 },
      }),
    );
    const blocks = res.output?.message?.content ?? [];
    return blocks
      .map((b) => ('text' in b && typeof b.text === 'string' ? b.text : ''))
      .join('\n')
      .trim();
  };
}

function buildTier3Prompt(req: ModelCriticRequest): string {
  const floor = req.floorFindings
    .map((f) => `- [${f.severity}] ${f.rule}: ${f.message}`)
    .join('\n');
  let budget = TIER3_MAX_ARTIFACT_CHARS;
  const arts: string[] = [];
  for (const a of req.artifacts) {
    const chunk = `### ${a.path}\n${a.content}`;
    if (chunk.length > budget) {
      arts.push(`### ${a.path}\n${a.content.slice(0, Math.max(0, budget))}\n…[truncated]`);
      break;
    }
    arts.push(chunk);
    budget -= chunk.length;
  }
  return [
    'Floor findings already raised (do not duplicate):',
    floor || '(none)',
    '',
    'Artifacts:',
    arts.join('\n\n') || '(none)',
  ].join('\n');
}

function parseTier3Findings(raw: string, checkId: string): CriticFinding[] {
  const json = extractJsonArray(raw);
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: CriticFinding[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const severity =
        o.severity === 'error' || o.severity === 'warning' ? o.severity : null;
      const rule = typeof o.rule === 'string' ? o.rule.trim() : '';
      const message = typeof o.message === 'string' ? o.message.trim() : '';
      if (!severity || !rule || !message) continue;
      out.push({
        checkId,
        rule: rule.slice(0, 80),
        severity,
        message: message.slice(0, 500),
        ...(typeof o.path === 'string' ? { path: o.path.slice(0, 260) } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function extractJsonArray(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) return trimmed;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]?.trim().startsWith('[')) return fence[1].trim();
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return null;
}

/**
 * Resolve opt-in critic from environment.
 * `WALKCROACH_ENABLE_MODEL_CRITIC=1` + optional `WALKCROACH_MODEL_CRITIC_TIER=2|3`.
 */
export function isModelCriticEnabledFromEnv(): boolean {
  const v = process.env.WALKCROACH_ENABLE_MODEL_CRITIC?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function resolveModelCriticFromEnv(): {
  enableModelCritic: boolean;
  modelCritic?: ModelCritic;
  tier?: 2 | 3;
} {
  if (!isModelCriticEnabledFromEnv()) {
    return { enableModelCritic: false };
  }
  const tierRaw = process.env.WALKCROACH_MODEL_CRITIC_TIER?.trim();
  const tier: 2 | 3 = tierRaw === '3' ? 3 : 2;
  return {
    enableModelCritic: true,
    tier,
    modelCritic:
      tier === 3
        ? createTier3LlmModelCritic()
        : createTier2HeuristicModelCritic(),
  };
}
