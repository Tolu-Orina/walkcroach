import { describe, it, expect } from 'vitest';
import {
  MAX_SCREENSHOT_EDGE,
  MAX_UPLOAD_BASE64,
  base64FromDataUrl,
  fitWithin,
  isWithinUploadLimit,
} from './screenshot';

describe('fitWithin', () => {
  it('leaves an already-small image alone', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('never upscales', () => {
    expect(fitWithin(200, 100)).toEqual({ width: 200, height: 100 });
  });

  it('scales the long edge down to the cap, preserving aspect ratio', () => {
    const out = fitWithin(3840, 2160);
    expect(out.width).toBe(MAX_SCREENSHOT_EDGE);
    expect(out.height).toBe(Math.round(2160 * (MAX_SCREENSHOT_EDGE / 3840)));
    expect(out.width / out.height).toBeCloseTo(3840 / 2160, 2);
  });

  it('handles portrait, where height is the long edge', () => {
    const out = fitWithin(1000, 4000);
    expect(out.height).toBe(MAX_SCREENSHOT_EDGE);
    expect(out.width).toBe(300);
  });

  it('never rounds a dimension to zero', () => {
    const out = fitWithin(10000, 3);
    expect(out.width).toBe(MAX_SCREENSHOT_EDGE);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });

  it('returns zeroes for a degenerate bitmap rather than dividing by zero', () => {
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(-5, 100)).toEqual({ width: 0, height: 0 });
  });

  it('honours a custom cap', () => {
    expect(fitWithin(2000, 1000, 500)).toEqual({ width: 500, height: 250 });
  });
});

describe('base64FromDataUrl', () => {
  it('extracts the payload', () => {
    expect(base64FromDataUrl('data:image/jpeg;base64,AAECAw==')).toBe('AAECAw==');
  });

  it('rejects a non-data URL', () => {
    expect(base64FromDataUrl('https://example.test/a.jpg')).toBeNull();
  });

  it('rejects a data URL that is not base64 encoded', () => {
    expect(base64FromDataUrl('data:text/plain,hello')).toBeNull();
  });

  it('rejects an empty payload', () => {
    expect(base64FromDataUrl('data:image/jpeg;base64,')).toBeNull();
  });
});

describe('isWithinUploadLimit', () => {
  const shot = (base64Length: number) => ({
    dataUrl: '',
    width: 1,
    height: 1,
    base64Length,
  });

  it('accepts a normal downscaled screenshot', () => {
    expect(isWithinUploadLimit(shot(120_000))).toBe(true);
  });

  it('accepts exactly the limit', () => {
    expect(isWithinUploadLimit(shot(MAX_UPLOAD_BASE64))).toBe(true);
  });

  it('rejects beyond it, matching the BFF cap', () => {
    // The server returns 413 past this; catching it client-side gives the user
    // an actionable message instead of a failed request.
    expect(isWithinUploadLimit(shot(MAX_UPLOAD_BASE64 + 1))).toBe(false);
  });
});
