import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Contrast regression guard for the Graphite Lumen tokens.
 *
 * Colour choices are easy to nudge and impossible to eyeball: Web's light-mode
 * steel (#3b6fd4) sits at 4.48:1 on this canvas — visually fine, and two
 * hundredths under AA for the 10.5px eyebrow text it is used for. This parses the
 * real stylesheet so a future edit cannot quietly drop below the line.
 *
 * Thresholds: WCAG 2.2 AA — 4.5:1 for normal text, 3:1 for non-text UI
 * (focus rings, meter fills).
 */

const CSS = readFileSync(resolve(import.meta.dirname, 'tokens.css'), 'utf-8');

/** Pull one `--name: #hex;` out of a specific rule block. */
function tokensFrom(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = CSS.indexOf('{', start);
  const block = CSS.slice(open + 1, findBlockEnd(open));
  const out: Record<string, string> = {};
  for (const [, name, hex] of block.matchAll(
    /--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g,
  )) {
    out[name!] = hex!.toLowerCase();
  }
  return out;
}

function findBlockEnd(openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return CSS.length;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const dark = tokensFrom(":root[data-theme='dark']");
const light = tokensFrom(":root[data-theme='light']");

/** Surfaces text can land on. `canvas-base` is the lightest part of the gradient. */
function surfaces(t: Record<string, string>): Array<[string, string]> {
  return [
    ['canvas', t['canvas-base']!],
    ['ink', t['ink']!],
    ['panel', t['panel']!],
    ['raised', t['raised']!],
  ];
}

describe.each([
  ['dark', dark],
  ['light', light],
])('%s mode — WCAG AA', (_mode, t) => {
  it('defines every colour token the stylesheet relies on', () => {
    for (const key of [
      'ink',
      'panel',
      'raised',
      'line',
      'mist',
      'paper',
      'signal',
      'steel',
      'ember',
      'focus',
      'canvas-base',
    ]) {
      expect(t[key], `missing --${key}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('body text clears 4.5:1 on every surface', () => {
    for (const [name, bg] of surfaces(t)) {
      expect(contrast(t['paper']!, bg), `paper on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('muted text clears 4.5:1 on every surface', () => {
    for (const [name, bg] of surfaces(t)) {
      expect(contrast(t['mist']!, bg), `mist on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('steel clears 4.5:1 — it carries eyebrow text at ~10.5px', () => {
    for (const [name, bg] of surfaces(t)) {
      expect(contrast(t['steel']!, bg), `steel on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('error text clears 4.5:1 on every surface', () => {
    for (const [name, bg] of surfaces(t)) {
      expect(contrast(t['ember']!, bg), `ember on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the primary button label clears 4.5:1 on amber', () => {
    // .wc-btn--primary pins its label to ink-black in both modes.
    expect(contrast('#0b0c0f', t['signal']!)).toBeGreaterThanOrEqual(4.5);
  });

  it('the focus ring clears 3:1 on every surface it can land on', () => {
    for (const [name, bg] of surfaces(t)) {
      expect(contrast(t['focus']!, bg), `focus on ${name}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('brand parity with WalkCroach Web', () => {
  it('keeps Web’s dark palette verbatim', () => {
    // Divergence here would fail the side-by-side brand test.
    expect(dark['ink']).toBe('#0b0c0f');
    expect(dark['panel']).toBe('#14161b');
    expect(dark['raised']).toBe('#1c1f26');
    expect(dark['paper']).toBe('#f2f3f5');
    expect(dark['signal']).toBe('#f0b429');
    expect(dark['steel']).toBe('#6b9eff');
    expect(dark['ember']).toBe('#f07167');
  });

  it('documents the only three deliberate light-mode divergences', () => {
    // All three are accessibility corrections, not restyling — same hue and
    // saturation, marginally darker. Anything else drifting is a bug.
    expect(light['steel']).toBe('#3067d2'); // Web: #3b6fd4 (4.48:1 on canvas)
    expect(light['focus']).toBe('#b47f09'); // Web signal: #c48a0a (2.83:1)
    expect(light['ember']).toBe('#c0400c'); // Web: #c2410c (4.45:1 on raised)
    expect(light['ink']).toBe('#f4f5f7');
    expect(light['panel']).toBe('#ffffff');
    expect(light['paper']).toBe('#12141a');
    expect(light['signal']).toBe('#c48a0a');

  });
});
