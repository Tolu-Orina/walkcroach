/**
 * Creative brief generation (slides / flyer / video) via Nova 2 Lite.
 *
 * Paid-only at the tool gate — this module only talks to Bedrock.
 * Extended thinking is always on (same policy as the agent loop).
 * We do **not** use Amazon Nova 1 Pro — AWS recommends Nova 2 Lite +
 * extended thinking for former Pro workloads (see docs/nova-2-lite.md).
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  getBedrockRegion,
  getNovaModelId,
  getNovaReasoningEffort,
} from './bedrock.js';
import { creativeMetric } from './metrics.js';

export type CreativeBriefSlide = {
  title: string;
  bullets: string[];
  notes?: string;
  image_key?: string;
};

export type CreativeBrief = {
  title: string;
  subtitle?: string;
  slides: CreativeBriefSlide[];
  estimatedImages: number;
  /** Accessible description when estimatedImages > 0 (Phase E3). */
  altText?: string;
  palette?: string[];
};

/** @deprecated Removed — call getNovaModelId(). Kept as alias so old imports compile. */
export function getNovaProModelId(): string {
  return getNovaModelId();
}

function creativeConverseExtras(): {
  additionalModelRequestFields: {
    reasoningConfig: {
      type: 'enabled';
      maxReasoningEffort: 'low' | 'medium' | 'high';
    };
  };
  inferenceConfig?: { maxTokens: number };
} {
  const effort = getNovaReasoningEffort();
  return {
    additionalModelRequestFields: {
      reasoningConfig: {
        type: 'enabled',
        maxReasoningEffort: effort,
      },
    },
    // High forbids maxTokens; medium/low use the reasoning output budget.
    ...(effort === 'high' ? {} : { inferenceConfig: { maxTokens: 30_000 } }),
  };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeBrief(raw: Record<string, unknown>, topic: string): CreativeBrief {
  const slidesRaw = Array.isArray(raw.slides) ? raw.slides : [];
  const slides: CreativeBriefSlide[] = slidesRaw.slice(0, 8).map((s, i) => {
    const row = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const bullets = Array.isArray(row.bullets)
      ? row.bullets.map((b) => String(b)).filter(Boolean).slice(0, 6)
      : [];
    return {
      title: String(row.title ?? `Slide ${i + 1}`).slice(0, 120),
      bullets:
        bullets.length > 0
          ? bullets
          : [String(row.notes ?? row.body ?? 'Key point').slice(0, 220)],
      notes: row.notes ? String(row.notes).slice(0, 500) : undefined,
      image_key: row.image_key ? String(row.image_key) : undefined,
    };
  });
  if (slides.length === 0) {
    slides.push(
      {
        title: 'Overview',
        bullets: [topic.slice(0, 200) || 'Introduce the topic'],
      },
      {
        title: 'Key points',
        bullets: ['Point one', 'Point two', 'Point three'],
      },
      {
        title: 'Next steps',
        bullets: ['Decide owners', 'Set a timeline', 'Ship a first draft'],
      },
    );
  }
  const estimatedImages = slides.filter((s) => s.image_key).length;
  const altRaw = String(raw.altText ?? raw.alt_text ?? '').trim();
  const altText =
    estimatedImages > 0
      ? (altRaw || `Illustration for ${String(raw.title ?? topic).slice(0, 80)}`).slice(
          0,
          255,
        )
      : altRaw
        ? altRaw.slice(0, 255)
        : undefined;
  return {
    title: String(raw.title ?? topic).slice(0, 120) || 'Untitled deck',
    subtitle: raw.subtitle ? String(raw.subtitle).slice(0, 200) : undefined,
    slides,
    estimatedImages,
    altText,
    palette: Array.isArray(raw.palette)
      ? raw.palette.map((p) => String(p)).slice(0, 8)
      : ['#0b0c0f', '#f2f3f5', '#f0b429', '#6b9eff'],
  };
}

/**
 * Ask Nova 2 Lite (extended thinking) for a structured slide brief.
 * Falls back to a deterministic stub if Bedrock is unavailable —
 * the stub is still valid for render_pptx so local/dev is unblocked.
 */
export async function generateCreativeBrief(params: {
  topic: string;
  slideCount?: number;
  audience?: string;
  tone?: string;
}): Promise<{ brief: CreativeBrief; modelId: string; stub: boolean }> {
  const topic = params.topic.trim().slice(0, 2000);
  const slideCount = Math.min(8, Math.max(3, Number(params.slideCount ?? 5)));
  const modelId = getNovaModelId();

  const system = `You are WalkCroach Creative Studio. Output ONLY a JSON object for a PowerPoint brief.
Schema:
{
  "title": string,
  "subtitle": string,
  "slides": [{"title": string, "bullets": string[], "notes": string, "image_key": string|null}],
  "altText": string,  // required when any slide has image_key — short accessible description of stills
  "palette": string[]  // hex colors; default Graphite Lumen if unspecified
}
Rules:
- Exactly ${slideCount} content slides (title slide is added by the renderer — do NOT include a title-only slide).
- Bullets: 3–5 short lines, no literal "•" characters, no lorem/ipsum/TODO.
- image_key: optional short snake_case id when a still would help; otherwise null.
- If any image_key is set, altText must describe the imagery in one plain sentence (no "image of").
- No absolute guaranteed finance/medical cure claims.
- Brand default palette: #0b0c0f, #f2f3f5, #f0b429, #6b9eff unless the user supplies a brand.`;

  const user = [
    `Topic: ${topic}`,
    params.audience ? `Audience: ${params.audience}` : '',
    params.tone ? `Tone: ${params.tone}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const client = new BedrockRuntimeClient({ region: getBedrockRegion() });
    const res = await client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: system }],
        messages: [{ role: 'user', content: [{ text: user }] }],
        ...creativeConverseExtras(),
      }),
    );
    creativeMetric('ProInvokeCount', { feature: 'creative_brief', tier: 'paid' });
    const text =
      res.output?.message?.content
        ?.map((b) => ('text' in b && typeof b.text === 'string' ? b.text : ''))
        .join('\n') ?? '';
    const parsed = extractJsonObject(text);
    if (!parsed) throw new Error('Nova 2 Lite returned no JSON brief');
    return { brief: normalizeBrief(parsed, topic), modelId, stub: false };
  } catch {
    // Deterministic stub so local/CI can exercise render without Bedrock access
    const stub: CreativeBrief = {
      title: topic.slice(0, 80) || 'WalkCroach deck',
      subtitle: params.audience
        ? `For ${params.audience}`
        : 'Prepared with WalkCroach Creative Studio',
      slides: Array.from({ length: slideCount }, (_, i) => ({
        title: i === 0 ? 'Overview' : i === slideCount - 1 ? 'Next steps' : `Point ${i + 1}`,
        bullets:
          i === 0
            ? [
                topic.slice(0, 160) || 'Introduce the opportunity',
                'Why it matters now',
                'What success looks like',
              ]
            : i === slideCount - 1
              ? ['Agree owners', 'Set a date', 'Ship a first draft']
              : [
                  `Detail ${i} for ${topic.slice(0, 40) || 'the topic'}`,
                  'Evidence or example',
                  'Implication for the audience',
                ],
      })),
      estimatedImages: 0,
      palette: ['#0b0c0f', '#f2f3f5', '#f0b429', '#6b9eff'],
    };
    return { brief: stub, modelId, stub: true };
  }
}

/* ------------------------------ flyer brief (Phase C) -------------------- */

export type FlyerBrief = {
  title: string;
  brand: string;
  eyebrow: string;
  headline: string;
  support: string;
  cta: string;
  meta?: string;
  location?: string;
  template: 'sale' | 'event' | 'announcement';
  /** walkcroach-creative-philosophy step 1 — internal, not a user essay */
  philosophy: {
    name: string;
    notes: string;
  };
  estimatedImages: number;
  /** Accessible description when estimatedImages > 0 (Phase E3). */
  altText?: string;
  palette: string[];
};

function normalizeFlyerBrief(raw: Record<string, unknown>, topic: string): FlyerBrief {
  const tmplRaw = String(raw.template ?? 'sale').toLowerCase();
  const template =
    tmplRaw === 'event' || tmplRaw === 'announcement' ? tmplRaw : 'sale';
  const philosophyRaw =
    raw.philosophy && typeof raw.philosophy === 'object'
      ? (raw.philosophy as Record<string, unknown>)
      : {};
  const estimatedImages = Number(raw.estimatedImages ?? 0) > 0 ? 1 : 0;
  const altRaw = String(raw.altText ?? raw.alt_text ?? '').trim();
  const altText =
    estimatedImages > 0
      ? (
          altRaw ||
          `Flyer visual for ${String(raw.headline ?? raw.title ?? topic).slice(0, 80)}`
        ).slice(0, 255)
      : altRaw
        ? altRaw.slice(0, 255)
        : undefined;
  return {
    title: String(raw.title ?? raw.headline ?? topic).slice(0, 120) || 'Flyer',
    brand: String(raw.brand ?? 'WalkCroach').slice(0, 80),
    eyebrow: String(raw.eyebrow ?? 'Now on').slice(0, 80),
    headline: String(raw.headline ?? raw.title ?? topic).slice(0, 120),
    support: String(raw.support ?? raw.subtitle ?? '').slice(0, 280),
    cta: String(raw.cta ?? 'Learn more').slice(0, 60),
    meta: raw.meta ? String(raw.meta).slice(0, 120) : undefined,
    location: raw.location ? String(raw.location).slice(0, 120) : undefined,
    template,
    philosophy: {
      name: String(philosophyRaw.name ?? 'Steel Pulse').slice(0, 40),
      notes: String(
        philosophyRaw.notes ??
          'Cool graphite field, sparse amber CTA, one dominant headline — not a stock template.',
      ).slice(0, 600),
    },
    estimatedImages,
    altText,
    palette: Array.isArray(raw.palette)
      ? raw.palette.map((p) => String(p)).slice(0, 8)
      : ['#0b0c0f', '#f2f3f5', '#f0b429', '#6b9eff'],
  };
}

/**
 * Flyer brief with walkcroach-creative-philosophy (Phase C2) via Nova 2 Lite.
 * Philosophy is stored on the brief for ConfirmCard + renderer atmosphere.
 */
export async function generateFlyerBrief(params: {
  topic: string;
  template?: 'sale' | 'event' | 'announcement';
  brand?: string;
  audience?: string;
}): Promise<{ brief: FlyerBrief; modelId: string; stub: boolean }> {
  const topic = params.topic.trim().slice(0, 2000);
  const modelId = getNovaModelId();
  const preferred = params.template ?? 'sale';

  const system = `You are WalkCroach Flyer Studio. Follow walkcroach-creative-philosophy:
1) Invent a short visual philosophy (name + 3–5 dense sentences on space, color, scale, how text appears).
2) Express it as flyer copy fields — never walls of copy.
Output ONLY JSON:
{
  "title": string,
  "brand": string,
  "eyebrow": string,
  "headline": string,
  "support": string,
  "cta": string,
  "meta": string,
  "location": string,
  "template": "sale"|"event"|"announcement",
  "philosophy": {"name": string, "notes": string},
  "estimatedImages": 0|1,
  "altText": string,  // required when estimatedImages is 1
  "palette": string[]
}
Rules:
- One headline, one support line, one CTA. No lorem/ipsum/TODO.
- Prefer template "${preferred}" unless the request clearly needs another.
- If estimatedImages is 1, altText must be one plain sentence describing the visual.
- No absolute guaranteed finance/medical cure claims.
- Default Graphite Lumen palette: #0b0c0f, #f2f3f5, #f0b429, #6b9eff
- Avoid purple gradients, cream+terracotta, broadsheet columns.`;

  const user = [
    `Topic: ${topic}`,
    params.brand ? `Brand: ${params.brand}` : '',
    params.audience ? `Audience: ${params.audience}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const client = new BedrockRuntimeClient({ region: getBedrockRegion() });
    const res = await client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: system }],
        messages: [{ role: 'user', content: [{ text: user }] }],
        ...creativeConverseExtras(),
      }),
    );
    creativeMetric('ProInvokeCount', { feature: 'flyer_brief', tier: 'paid' });
    const text =
      res.output?.message?.content
        ?.map((b) => ('text' in b && typeof b.text === 'string' ? b.text : ''))
        .join('\n') ?? '';
    const parsed = extractJsonObject(text);
    if (!parsed) throw new Error('Nova 2 Lite returned no flyer JSON');
    return { brief: normalizeFlyerBrief(parsed, topic), modelId, stub: false };
  } catch {
    const stub: FlyerBrief = {
      title: topic.slice(0, 80) || 'Sale flyer',
      brand: params.brand?.slice(0, 80) || 'WalkCroach',
      eyebrow: preferred === 'event' ? 'This weekend' : 'Limited offer',
      headline:
        preferred === 'event'
          ? topic.slice(0, 80) || 'Join us'
          : `${topic.slice(0, 60) || 'Sale'} starts now`,
      support:
        'One clear reason to act — crafted for this moment, not a stock template.',
      cta: preferred === 'event' ? 'Reserve a spot' : 'Shop the offer',
      meta: params.audience ? `For ${params.audience}` : undefined,
      template: preferred,
      philosophy: {
        name: 'Steel Pulse',
        notes:
          'Cool graphite canvas with a sparse amber CTA. Large headline, short support, full-bleed atmosphere — meticulously made for this SME.',
      },
      estimatedImages: 0,
      palette: ['#0b0c0f', '#f2f3f5', '#f0b429', '#6b9eff'],
    };
    return { brief: stub, modelId, stub: true };
  }
}

/* ------------------------------ video brief (Phase D) -------------------- */

export type VideoShotBrief = {
  text: string;
  stillPrompt?: string;
};

export type VideoBrief = {
  title: string;
  brand: string;
  /** Single Nova Reel MULTI_SHOT_AUTOMATED prompt (≤4000 chars). */
  reelPrompt: string;
  voiceoverScript: string;
  /** Always 30 for product default (one async job). */
  durationSec: number;
  aspect: '16:9' | '9:16';
  /** AUTOMATED accepts no stills — always 0. */
  estimatedImages: number;
  /** Kept empty for AUTOMATED; MANUAL legacy only. */
  shots: VideoShotBrief[];
  palette: string[];
};

function normalizeVideoBrief(raw: Record<string, unknown>, topic: string): VideoBrief {
  const aspectRaw = String(raw.aspect ?? '16:9');
  const aspect: '16:9' | '9:16' = aspectRaw === '9:16' ? '9:16' : '16:9';
  const reelPrompt = String(
    raw.reelPrompt ?? raw.prompt ?? raw.text ?? topic,
  )
    .trim()
    .slice(0, 4000);
  return {
    title: String(raw.title ?? topic).slice(0, 120) || 'WalkCroach video',
    brand: String(raw.brand ?? 'WalkCroach').slice(0, 80),
    reelPrompt:
      reelPrompt ||
      `Cinematic 30-second marketing film for ${topic.slice(0, 200)}. Graphite Lumen look, confident pacing, clear brand close.`,
    voiceoverScript: String(
      raw.voiceoverScript ?? raw.script ?? topic,
    ).slice(0, 2000),
    durationSec: 30,
    aspect,
    estimatedImages: 0,
    shots: [],
    palette: Array.isArray(raw.palette)
      ? raw.palette.map((p) => String(p)).slice(0, 8)
      : ['#0b0c0f', '#f2f3f5', '#f0b429', '#6b9eff'],
  };
}

/**
 * Video brief via Nova 2 Lite — one 30s MULTI_SHOT_AUTOMATED Reel job + Polly script.
 */
export async function generateVideoBrief(params: {
  topic: string;
  brand?: string;
  audience?: string;
  aspect?: '16:9' | '9:16';
}): Promise<{ brief: VideoBrief; modelId: string; stub: boolean }> {
  const topic = params.topic.trim().slice(0, 2000);
  const modelId = getNovaModelId();
  const preferredAspect = params.aspect ?? '16:9';

  const system = `You are WalkCroach Video Studio. Output ONLY JSON for a single 30-second Nova Reel MULTI_SHOT_AUTOMATED job (one StartAsyncInvoke, durationSeconds=30 — not five separate 6s clips):
{
  "title": string,
  "brand": string,
  "reelPrompt": string,
  "voiceoverScript": string,
  "aspect": "16:9"|"9:16",
  "palette": string[]
}
Rules:
- One continuous 30s concept in reelPrompt (opening → offer → CTA). English only. ≤4000 chars.
- No shot list. No stillPrompt. No lorem/ipsum/TODO.
- Prefer aspect "${preferredAspect}".
- Default palette: #0b0c0f, #f2f3f5, #f0b429, #6b9eff`;

  const user = [
    `Topic: ${topic}`,
    params.brand ? `Brand: ${params.brand}` : '',
    params.audience ? `Audience: ${params.audience}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const client = new BedrockRuntimeClient({ region: getBedrockRegion() });
    const res = await client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: system }],
        messages: [{ role: 'user', content: [{ text: user }] }],
        ...creativeConverseExtras(),
      }),
    );
    creativeMetric('ProInvokeCount', { feature: 'video_brief', tier: 'paid' });
    const text =
      res.output?.message?.content
        ?.map((b) => ('text' in b && typeof b.text === 'string' ? b.text : ''))
        .join('\n') ?? '';
    const parsed = extractJsonObject(text);
    if (!parsed) throw new Error('Nova 2 Lite returned no video JSON');
    if (params.aspect) parsed.aspect = params.aspect;
    if (params.brand) parsed.brand = params.brand;
    return { brief: normalizeVideoBrief(parsed, topic), modelId, stub: false };
  } catch {
    const stub: VideoBrief = normalizeVideoBrief(
      {
        title: topic.slice(0, 80) || 'WalkCroach teaser',
        brand: params.brand ?? 'WalkCroach',
        aspect: preferredAspect,
        reelPrompt: [
          `A continuous 30-second cinematic marketing film for ${topic.slice(0, 120) || 'the brand'}.`,
          'Open on a confident brand frame, move through the offer with sparse Graphite Lumen lighting,',
          'and close on a clear call to action. One coherent thirty-second arc.',
        ].join(' '),
        voiceoverScript: [
          `${params.brand ?? 'WalkCroach'} presents.`,
          topic.slice(0, 120) || 'A short story for your customers.',
          'Clear offer. Real momentum. Made for the next thirty seconds.',
        ].join(' '),
        palette: ['#0b0c0f', '#f2f3f5', '#f0b429', '#6b9eff'],
      },
      topic,
    );
    return { brief: stub, modelId, stub: true };
  }
}
