import { describe, expect, it } from 'vitest';
import {
  moderateCreativeCopyRules,
} from './creative-moderation.js';
import { creativeEmbedText } from './creative-memory.js';
import { toBedrockTools, getToolKind } from './tools.js';

describe('Phase E creative memory + moderation', () => {
  it('exposes recall_creative and save_creative_memory on chat', () => {
    const names = toBedrockTools('chat').map((t) => t.toolSpec.name);
    expect(names).toContain('recall_creative');
    expect(names).toContain('save_creative_memory');
    expect(getToolKind('recall_creative')).toBe('server');
  });

  it('blocks guaranteed financial claims', () => {
    const v = moderateCreativeCopyRules({
      headline: 'Guaranteed results — double your money risk-free!',
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reasons.length).toBeGreaterThan(0);
  });

  it('allows ordinary SME marketing copy', () => {
    const v = moderateCreativeCopyRules({
      headline: 'Spring sale on sourdough — this weekend only',
      support: 'Fresh loaves from our bakery. While stocks last.',
      cta: 'Visit us Saturday',
    });
    expect(v.ok).toBe(true);
  });

  it('builds embed text from brief fields', () => {
    const text = creativeEmbedText({
      kind: 'flyer',
      brief: {
        title: 'Bakery sale',
        brand: 'Crust & Co',
        palette: ['#0b0c0f', '#f0b429'],
      },
    });
    expect(text).toContain('Bakery sale');
    expect(text).toContain('Crust & Co');
  });
});
