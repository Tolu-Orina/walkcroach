/**
 * Dual-funnel P1 — semantic parity: harness + /v1 handlers share MEMORY_KINDS
 * (handlers import MEMORY_KINDS from `@walkcroach/agent-harness` re-export).
 */
import { describe, expect, it } from 'vitest';
import {
  MEMORY_KINDS,
  isMemoryKind,
  normalizeMemoryKind,
} from '@walkcroach/memory-contracts';

describe('memory contract parity (P1)', () => {
  it('MEMORY_KINDS is the canonical six-kind set', () => {
    expect([...MEMORY_KINDS].sort()).toEqual(
      ['capture', 'convention', 'decision', 'preference', 'qa', 'summary'].sort(),
    );
  });

  it('normalizeMemoryKind matches isMemoryKind for every canonical kind', () => {
    for (const kind of MEMORY_KINDS) {
      expect(isMemoryKind(kind)).toBe(true);
      expect(normalizeMemoryKind(kind)).toBe(kind);
    }
  });

  it('unknown kinds fall back to decision (shared policy)', () => {
    expect(normalizeMemoryKind('nope')).toBe('decision');
    expect(normalizeMemoryKind(undefined)).toBe('decision');
    expect(normalizeMemoryKind('PREFERENCE')).toBe('preference');
  });
});
