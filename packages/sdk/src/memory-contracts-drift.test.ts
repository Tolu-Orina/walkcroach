/**
 * Dual-loop snapshot: SDK client types accept harness fixtures (P4.2).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MEMORY_KINDS,
  EXPORT_FORMAT,
  validateExport,
  type RememberResult,
  type MemoryExport,
} from './types.js';

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'memory-contracts',
  'fixtures',
);

describe('SDK ↔ harness memory drift (P4.2)', () => {
  it('reads harness export fixture via shared validateExport', () => {
    const raw = JSON.parse(
      readFileSync(join(fixtures, 'harness-memory-export.json'), 'utf8'),
    );
    const bundle: MemoryExport = validateExport(raw);
    expect(bundle.format).toBe(EXPORT_FORMAT);
    expect(bundle.entries.every((e) => MEMORY_KINDS.includes(e.kind))).toBe(
      true,
    );
  });

  it('types harness remember result as RememberResult', () => {
    const raw = JSON.parse(
      readFileSync(join(fixtures, 'harness-remember-result.json'), 'utf8'),
    ) as RememberResult;
    expect(raw.supersededId).toBeTruthy();
    expect(MEMORY_KINDS.includes(raw.kind)).toBe(true);
  });
});
