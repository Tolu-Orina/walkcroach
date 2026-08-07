/**
 * Dual-loop memory drift fixtures (P4.2).
 *
 * These snapshots are the shapes both loops must accept. Harness write →
 * SDK-readable; SDK remember → harness-validatable export.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  MEMORY_KINDS,
  validateExport,
  ImportFormatError,
  normalizeMemoryKind,
  type RememberResult,
  type MemoryExport,
} from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures');

describe('memory-contracts kinds (P4.1)', () => {
  it('exposes the six OpenAPI-aligned kinds in order', () => {
    expect([...MEMORY_KINDS]).toEqual([
      'decision',
      'preference',
      'convention',
      'summary',
      'capture',
      'qa',
    ]);
  });

  it('normalizes unknown kinds to decision (shared policy)', () => {
    expect(normalizeMemoryKind('nonsense')).toBe('decision');
    expect(normalizeMemoryKind('CAPTURE')).toBe('capture');
    expect(normalizeMemoryKind(undefined, 'preference')).toBe('preference');
  });
});

describe('dual-loop export fixture (P4.2)', () => {
  it('validates a harness-shaped export that the SDK can read', () => {
    const raw = JSON.parse(
      readFileSync(join(fixtures, 'harness-memory-export.json'), 'utf8'),
    );
    const bundle = validateExport(raw);
    expect(bundle.format).toBe(EXPORT_FORMAT);
    expect(bundle.version).toBe(EXPORT_VERSION);
    expect(bundle.entries.length).toBeGreaterThan(0);
    for (const e of bundle.entries) {
      expect(MEMORY_KINDS).toContain(e.kind);
      expect(e.sourceSurface).toBeTruthy();
      expect(typeof e.supersededBy === 'string' || e.supersededBy === null).toBe(
        true,
      );
    }
    // Round-trip identity for SDK MemoryExport typing
    const asSdk: MemoryExport = bundle;
    expect(asSdk.entryCount).toBe(bundle.entries.length);
  });

  it('rejects wrong format (SDK would refuse the same way)', () => {
    expect(() =>
      validateExport({ format: 'other', version: '1.0', entries: [] }),
    ).toThrow(ImportFormatError);
  });
});

describe('dual-loop remember fixture (P4.2)', () => {
  it('accepts a harness write result as SDK RememberResult', () => {
    const raw = JSON.parse(
      readFileSync(join(fixtures, 'harness-remember-result.json'), 'utf8'),
    ) as RememberResult;
    expect(raw.id).toBeTruthy();
    expect(raw).toHaveProperty('supersededId');
    expect(MEMORY_KINDS).toContain(raw.kind);
    expect(raw.projectId).toBeTruthy();
    expect(raw.surface).toBeTruthy();
  });
});
