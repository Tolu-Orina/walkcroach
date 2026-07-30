/**
 * Nova Pro creative brief generation (Phase B2).
 *
 * Returns structured JSON the ConfirmCard and render_pptx both consume.
 * Paid-only at the tool gate — this module only talks to Bedrock.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { getBedrockRegion } from './bedrock.js';

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
  palette?: string[];
};

export function getNovaProModelId(): string {
  return (
    process.env.NOVA_PRO_MODEL_ID ??
    process.env.BEDROCK_NOVA_PRO_MODEL_ID ??
    'amazon.nova-pro-v1:0'
  );
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
  return {
    title: String(raw.title ?? topic).slice(0, 120) || 'Untitled deck',
    subtitle: raw.subtitle ? String(raw.subtitle).slice(0, 200) : undefined,
    slides,
    estimatedImages,
    palette: Array.isArray(raw.palette)
      ? raw.palette.map((p) => String(p)).slice(0, 8)
      : ['#0b0c0f', '#f2f3f5', '#f0b429', '#6b9eff'],
  };
}

/**
 * Ask Nova Pro for a structured slide brief.
 * Falls back to a deterministic Lite-free stub brief if Pro is unavailable —
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
  const modelId = getNovaProModelId();

  const system = `You are WalkCroach Creative Studio. Output ONLY a JSON object for a PowerPoint brief.
Schema:
{
  "title": string,
  "subtitle": string,
  "slides": [{"title": string, "bullets": string[], "notes": string, "image_key": string|null}],
  "palette": string[]  // hex colors; default Graphite Lumen if unspecified
}
Rules:
- Exactly ${slideCount} content slides (title slide is added by the renderer — do NOT include a title-only slide).
- Bullets: 3–5 short lines, no literal "•" characters, no lorem/ipsum/TODO.
- image_key: optional short snake_case id when a still would help; otherwise null.
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
        inferenceConfig: { maxTokens: 2048, temperature: 0.4 },
      }),
    );
    const text =
      res.output?.message?.content
        ?.map((b) => ('text' in b && typeof b.text === 'string' ? b.text : ''))
        .join('\n') ?? '';
    const parsed = extractJsonObject(text);
    if (!parsed) throw new Error('Nova Pro returned no JSON brief');
    return { brief: normalizeBrief(parsed, topic), modelId, stub: false };
  } catch {
    // Deterministic stub so local/CI can exercise render without Pro access
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
