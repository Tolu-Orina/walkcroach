import { describe, expect, it } from 'vitest';
import {
  isOpaqueReasoningText,
  stripOpaqueReasoningMarkers,
} from './reasoning-text.js';

describe('isOpaqueReasoningText', () => {
  it('treats [REDACTED] walls as opaque', () => {
    expect(isOpaqueReasoningText('[REDACTED]')).toBe(true);
    expect(
      isOpaqueReasoningText(
        '[REDACTED]. [REDACTED]. [REDACTED]. [REDACTED]',
      ),
    ).toBe(true);
    expect(isOpaqueReasoningText('')).toBe(true);
    expect(isOpaqueReasoningText('   ...  ')).toBe(true);
  });

  it('keeps real reasoning readable', () => {
    expect(isOpaqueReasoningText('Let me check the CSS tokens.')).toBe(false);
    expect(
      isOpaqueReasoningText('[REDACTED] then fix contrast'),
    ).toBe(false);
  });
});

describe('stripOpaqueReasoningMarkers', () => {
  it('removes markers and trims', () => {
    expect(stripOpaqueReasoningMarkers('[REDACTED]. [REDACTED]')).toBe('');
    expect(
      stripOpaqueReasoningMarkers('[REDACTED] then fix contrast'),
    ).toBe('then fix contrast');
  });
});
