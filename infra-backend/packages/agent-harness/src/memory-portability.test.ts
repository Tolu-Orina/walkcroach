import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  ImportFormatError,
  parseVector,
  validateExport,
} from './memory-portability.js';

const valid = {
  format: EXPORT_FORMAT,
  version: EXPORT_VERSION,
  exportedAt: '2026-08-04T12:00:00.000Z',
  projectId: '11111111-2222-3333-4444-555555555555',
  embeddingModel: 'amazon.titan-embed-text-v2:0',
  embeddingDimensions: 1024,
  entryCount: 1,
  entries: [
    {
      id: 'e1',
      kind: 'decision',
      text: 'Chose Drizzle over Prisma',
      sourceSurface: 'ide',
      createdAt: '2026-08-01T09:00:00.000Z',
      supersededBy: null,
    },
  ],
};

describe('validateExport', () => {
  it('accepts a well-formed bundle', () => {
    expect(validateExport(valid).entryCount).toBe(1);
  });

  it('rejects a foreign format rather than guessing', () => {
    // Importing someone else's export shape would silently produce garbage
    // memory, which is worse than refusing.
    expect(() => validateExport({ ...valid, format: 'mem0-export' })).toThrow(
      /unrecognised format/,
    );
  });

  it('accepts any 1.x minor version', () => {
    expect(() => validateExport({ ...valid, version: '1.7' })).not.toThrow();
  });

  it('rejects a future major version', () => {
    expect(() => validateExport({ ...valid, version: '2.0' })).toThrow(
      /unsupported export version/,
    );
  });

  it.each([
    [null, 'null'],
    ['a string', 'string'],
    [42, 'number'],
  ])('rejects a non-object bundle (%s)', (bundle) => {
    expect(() => validateExport(bundle)).toThrow(ImportFormatError);
  });

  it('requires entries to be an array', () => {
    expect(() => validateExport({ ...valid, entries: {} })).toThrow(/entries must be an array/);
  });

  it('names the offending index when an entry is malformed', () => {
    expect(() =>
      validateExport({ ...valid, entries: [valid.entries[0], { kind: 'decision' }] }),
    ).toThrow(/entries\[1\]\.text is required/);
  });

  it('carries a machine-readable code', () => {
    try {
      validateExport({ format: 'nope' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as ImportFormatError).code).toBe('IMPORT_FORMAT_INVALID');
    }
  });
});

describe('parseVector', () => {
  it('parses the CockroachDB VECTOR rendering', () => {
    expect(parseVector('[1,2.5,-3]')).toEqual([1, 2.5, -3]);
  });

  it('round-trips a full-width vector', () => {
    const v = Array.from({ length: 1024 }, (_, i) => i / 1024);
    expect(parseVector(`[${v.join(',')}]`)).toHaveLength(1024);
  });
});
