/**
 * Marketing-claim moderation for creative briefs / VO scripts (Phase E2).
 *
 * 1) Deterministic deny-list (always on; works local/CI)
 * 2) Optional Bedrock ApplyGuardrail when CREATIVE_GUARDRAIL_ID is set
 *
 * @see docs/walkcroach-master-doc.md (creative / guardrails)
 */
import {
  BedrockRuntimeClient,
  ApplyGuardrailCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { getBedrockRegion } from './bedrock.js';

export type ModerationVerdict =
  | { ok: true }
  | { ok: false; reasons: string[]; source: 'rules' | 'guardrail' };

const DENY_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  {
    re: /\b(guaranteed?|100%\s*guaranteed|risk[- ]free)\b.{0,40}\b(result|return|profit|income|cure|weight\s*loss)\b/i,
    reason: 'Absolute / guaranteed outcome claim',
  },
  {
    re: /\b(cure[sd]?|miracle|instant(?:ly)?\s+cure)\b.{0,30}\b(cancer|diabetes|disease|illness)\b/i,
    reason: 'Medical cure claim',
  },
  {
    re: /\b(fda[- ]approved|clinically\s+proven)\b(?!.{0,20}\b(consult|may|can)\b)/i,
    reason: 'Unqualified regulatory / clinical claim',
  },
  {
    re: /\b(get\s+rich\s+quick|passive\s+income\s+guaranteed|double\s+your\s+money)\b/i,
    reason: 'Financial get-rich / guaranteed money claim',
  },
  {
    re: /\b(no\s+credit\s+check\s+required\s+loan|payday\s+loan\s+guaranteed)\b/i,
    reason: 'Predatory lending claim',
  },
  {
    re: /\b(lorem\s+ipsum|\[insert|TODO:|xxx+)\b/i,
    reason: 'Placeholder / unfinished marketing copy',
  },
];

function flattenCreativeText(input: {
  title?: string;
  headline?: string;
  support?: string;
  cta?: string;
  bullets?: string[];
  voiceoverScript?: string;
  reelPrompt?: string;
  slides?: Array<{ title?: string; bullets?: string[] }>;
  raw?: string;
}): string {
  const parts: string[] = [];
  for (const v of [
    input.title,
    input.headline,
    input.support,
    input.cta,
    input.voiceoverScript,
    input.reelPrompt,
    input.raw,
  ]) {
    if (v) parts.push(v);
  }
  if (input.bullets) parts.push(...input.bullets);
  if (input.slides) {
    for (const s of input.slides) {
      if (s.title) parts.push(s.title);
      if (s.bullets) parts.push(...s.bullets);
    }
  }
  return parts.join('\n');
}

export function moderateCreativeCopyRules(
  input: Parameters<typeof flattenCreativeText>[0],
): ModerationVerdict {
  const text = flattenCreativeText(input);
  if (!text.trim()) return { ok: true };
  const reasons: string[] = [];
  for (const p of DENY_PATTERNS) {
    if (p.re.test(text)) reasons.push(p.reason);
  }
  if (reasons.length) return { ok: false, reasons, source: 'rules' };
  return { ok: true };
}

function creativeGuardrailIds(): { id: string; version: string } | null {
  const id = (
    process.env.CREATIVE_GUARDRAIL_ID ??
    process.env.BEDROCK_CREATIVE_GUARDRAIL_ID ??
    ''
  ).trim();
  if (!id) return null;
  const version = (
    process.env.CREATIVE_GUARDRAIL_VERSION ??
    process.env.BEDROCK_CREATIVE_GUARDRAIL_VERSION ??
    'DRAFT'
  ).trim();
  return { id, version };
}

async function applyCreativeGuardrail(text: string): Promise<ModerationVerdict> {
  const cfg = creativeGuardrailIds();
  if (!cfg) return { ok: true };
  try {
    const client = new BedrockRuntimeClient({ region: getBedrockRegion() });
    const res = await client.send(
      new ApplyGuardrailCommand({
        guardrailIdentifier: cfg.id,
        guardrailVersion: cfg.version,
        source: 'INPUT',
        content: [{ text: { text: text.slice(0, 10000) } }],
      }),
    );
    const action = res.action;
    if (action === 'GUARDRAIL_INTERVENED') {
      const reasons =
        res.assessments
          ?.flatMap((a) =>
            (a.topicPolicy?.topics ?? [])
              .filter((t) => t.action === 'BLOCKED')
              .map((t) => t.name ?? 'blocked topic'),
          )
          .filter(Boolean) ?? [];
      return {
        ok: false,
        reasons: reasons.length
          ? reasons.map(String)
          : ['Blocked by creative marketing guardrail'],
        source: 'guardrail',
      };
    }
    return { ok: true };
  } catch {
    // Fail open on guardrail infra errors — rules already ran.
    return { ok: true };
  }
}

/**
 * Full marketing moderation pass: rules first, then optional Bedrock guardrail.
 */
export async function moderateCreativeCopy(
  input: Parameters<typeof flattenCreativeText>[0],
): Promise<ModerationVerdict> {
  const rules = moderateCreativeCopyRules(input);
  if (!rules.ok) return rules;
  const text = flattenCreativeText(input);
  return applyCreativeGuardrail(text);
}
