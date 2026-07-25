import { describe, it, expect } from 'vitest';
import { displayMemoryText, memorySurfaceLabel } from './memoryDisplay';

describe('displayMemoryText', () => {
  it('strips chrome capture marker', () => {
    expect(
      displayMemoryText(
        '[chrome-capture:abc-123]\nTitle\nhttps://x.test\nBody',
        'chrome',
      ),
    ).toBe('Title\nhttps://x.test\nBody');
  });

  it('leaves non-chrome text alone', () => {
    expect(displayMemoryText('[chrome-capture:x]\nkeep', 'web')).toBe(
      '[chrome-capture:x]\nkeep',
    );
  });
});

describe('memorySurfaceLabel', () => {
  it('maps known surfaces', () => {
    expect(memorySurfaceLabel('chrome')).toBe('Chrome');
    expect(memorySurfaceLabel('ide')).toBe('IDE');
  });
});
