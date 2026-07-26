import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chunkLines,
  cosineSimilarity,
  semanticSearch,
  updateIndex,
  DEFAULT_CHUNK_OVERLAP_LINES,
  DEFAULT_CHUNK_WINDOW_LINES,
  MAX_INDEXABLE_FILE_BYTES,
  VECTORS_REL_PATH,
  type EmbedFn,
} from './local-index.js';

describe('chunkLines', () => {
  it('returns a single chunk for content shorter than the window', () => {
    const content = 'a\nb\nc';
    const chunks = chunkLines(content);
    expect(chunks).toEqual([{ startLine: 1, endLine: 3, text: 'a\nb\nc' }]);
  });

  it('windows a long file with overlap', () => {
    const lines = Array.from({ length: 400 }, (_, i) => `line ${i + 1}`);
    const content = lines.join('\n');
    const chunks = chunkLines(content, { windowLines: 150, overlapLines: 20 });

    // step = 150 - 20 = 130; starts at 1-index 1, 131, 261 (last window reaches 400 -> stop)
    expect(chunks[0]).toEqual({ startLine: 1, endLine: 150, text: expect.any(String) });
    expect(chunks[1]).toEqual({ startLine: 131, endLine: 280, text: expect.any(String) });
    expect(chunks[2]).toEqual({ startLine: 261, endLine: 400, text: expect.any(String) });
    expect(chunks).toHaveLength(3);
    // Overlap: chunk 1 ends at 280, chunk 2 starts at 261 -> 20 lines shared.
    expect(chunks[2]!.startLine).toBeLessThanOrEqual(chunks[1]!.endLine);
  });

  it('produces one empty-text chunk for empty content (callers filter blank chunks before embedding)', () => {
    expect(chunkLines('')).toEqual([{ startLine: 1, endLine: 1, text: '' }]);
  });

  it('uses the documented defaults when no options are passed', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `l${i}`);
    const chunks = chunkLines(lines.join('\n'));
    expect(chunks[0]!.endLine).toBe(DEFAULT_CHUNK_WINDOW_LINES);
    expect(chunks[1]!.startLine).toBe(
      DEFAULT_CHUNK_WINDOW_LINES - DEFAULT_CHUNK_OVERLAP_LINES + 1,
    );
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors, 0 for orthogonal, -1 for opposite', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('is 0 when either vector is all zeros', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
  });
});

/** Deterministic 2-D "embedding": [banana-ish-ness, car-ish-ness]. */
const stubEmbed: EmbedFn = async (text) => {
  const t = text.toLowerCase();
  return [
    t.includes('banana') || t.includes('fruit') ? 1 : 0,
    t.includes('car') || t.includes('engine') ? 1 : 0,
  ];
};

describe('updateIndex / semanticSearch', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function vectorPathsOnDisk(): Promise<string[]> {
    try {
      const raw = await readFile(join(dir, VECTORS_REL_PATH), 'utf8');
      const paths = new Set<string>();
      for (const line of raw.trim().split('\n').filter(Boolean)) {
        paths.add((JSON.parse(line) as { path: string }).path);
      }
      return [...paths].sort();
    } catch {
      return [];
    }
  }

  it('ranks the semantically closer file first', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-index-'));
    await writeFile(join(dir, 'fruit.ts'), 'export const note = "banana fruit stand";\n');
    await writeFile(join(dir, 'engine.ts'), 'export const note = "car engine repair";\n');

    await updateIndex(dir, stubEmbed);

    const bananaHits = await semanticSearch(dir, stubEmbed, 'banana', { topK: 1 });
    expect(bananaHits[0]?.path).toBe('fruit.ts');

    const carHits = await semanticSearch(dir, stubEmbed, 'car engine', { topK: 1 });
    expect(carHits[0]?.path).toBe('engine.ts');
  });

  it('skips re-embedding unchanged files, and only re-embeds a file that actually changed', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-index-'));
    await writeFile(join(dir, 'a.ts'), 'export const a = "banana";\n');
    await writeFile(join(dir, 'b.ts'), 'export const b = "car";\n');
    const embed = vi.fn(stubEmbed);

    const first = await updateIndex(dir, embed, { maxFiles: 100 });
    expect(first.reindexedFiles).toBe(2);
    expect(embed).toHaveBeenCalledTimes(2);

    embed.mockClear();
    const second = await updateIndex(dir, embed, { maxFiles: 100 });
    expect(second.reindexedFiles).toBe(0);
    expect(second.unchangedFiles).toBe(2);
    expect(embed).not.toHaveBeenCalled();

    // mtime resolution can be coarse — ensure the rewrite lands on a distinct mtime
    // so the fast path doesn't mistake it for unchanged (see local-index.ts trade-off note).
    await new Promise((r) => setTimeout(r, 15));
    await writeFile(join(dir, 'a.ts'), 'export const a = "banana split";\n');
    embed.mockClear();
    const third = await updateIndex(dir, embed, { maxFiles: 100 });
    expect(third.reindexedFiles).toBe(1);
    expect(third.unchangedFiles).toBe(1);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('drops a deleted file from the index on the next update', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-index-'));
    await writeFile(join(dir, 'a.ts'), 'export const a = "banana";\n');
    await writeFile(join(dir, 'b.ts'), 'export const b = "car";\n');
    await updateIndex(dir, stubEmbed);
    expect(await vectorPathsOnDisk()).toEqual(['a.ts', 'b.ts']);

    await rm(join(dir, 'a.ts'));
    await updateIndex(dir, stubEmbed);
    expect(await vectorPathsOnDisk()).toEqual(['b.ts']);

    const hits = await semanticSearch(dir, stubEmbed, 'banana');
    expect(hits.every((h) => h.path !== 'a.ts')).toBe(true);
  });

  it('caps discovery at maxFiles, picking the lexically first files', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-index-'));
    for (const name of ['f1.ts', 'f2.ts', 'f3.ts', 'f4.ts', 'f5.ts']) {
      await writeFile(join(dir, name), `export const x = "${name}";\n`);
    }

    await updateIndex(dir, stubEmbed, { maxFiles: 3 });
    expect(await vectorPathsOnDisk()).toEqual(['f1.ts', 'f2.ts', 'f3.ts']);
  });

  it('excludes node_modules and binary-extension files', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-index-'));
    await mkdir(join(dir, 'node_modules', 'dep'), { recursive: true });
    await writeFile(
      join(dir, 'node_modules', 'dep', 'index.js'),
      'export const dep = "banana";\n',
    );
    await writeFile(join(dir, 'logo.png'), 'not really a png but has an image ext');
    await writeFile(join(dir, 'real.ts'), 'export const real = "banana";\n');

    await updateIndex(dir, stubEmbed, { maxFiles: 100 });
    expect(await vectorPathsOnDisk()).toEqual(['real.ts']);
  });

  it('skips files larger than MAX_INDEXABLE_FILE_BYTES', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-index-'));
    await writeFile(join(dir, 'huge.ts'), 'x'.repeat(MAX_INDEXABLE_FILE_BYTES + 1));
    await writeFile(join(dir, 'small.ts'), 'export const s = "banana";\n');

    await updateIndex(dir, stubEmbed, { maxFiles: 100 });
    expect(await vectorPathsOnDisk()).toEqual(['small.ts']);
  });

  it('returns no hits when nothing has been indexed', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-index-'));
    const hits = await semanticSearch(dir, stubEmbed, 'anything');
    expect(hits).toEqual([]);
  });
});
