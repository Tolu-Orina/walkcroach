import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, loadEnv } from '@walkcroach/db';
import { mintApiKey } from './api-keys.js';
import { normalizeEvent } from './event.js';
import { handleIdeRest } from './handlers/rest.js';
import { hasCrdb } from './test/ide-api.harness.js';

// Database only — no Bedrock. See the note in test/setup.ts for why `.env` is
// loaded here rather than globally.
loadEnv(process.cwd());

/**
 * Integration coverage for the public `/v1` SDK surface.
 *
 * Deliberately exercises only the routes that need no embeddings: recall and
 * remember call Bedrock, and there are no AWS credentials on a normal dev
 * machine here (deploys go through gitops). Those two are covered by mocked
 * tests in `@walkcroach/sdk` and must additionally be smoke-tested against a
 * deployed environment before their behaviour is claimed anywhere.
 */
const describeDb = hasCrdb() ? describe : describe.skip;

type Res = { statusCode: number; body: string };

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<{ status: number; json: Record<string, never> }> {
  const res = (await handleIdeRest(
    normalizeEvent({
      httpMethod: method,
      path,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
      pathParameters: {},
      queryStringParameters: opts.query ?? {},
    }),
  )) as Res;
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : {} };
}

describe('SDK surface routing', () => {
  it('serves /v1/health without credentials', async () => {
    const res = await call('GET', '/v1/health');
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, surface: 'sdk', version: 'v1' });
  });

  it('does not shadow the published /ide/v1 surface', async () => {
    // walkcroach-ide@0.2.0 and @walkcroach/cli@0.3.0 are pinned against these.
    const res = await call('GET', '/ide/v1/health');
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ surface: 'ide' });
  });

  it('requires authorization on memory routes', async () => {
    const res = await call('POST', '/v1/memory/recall', { body: { projectId: randomUUID() } });
    expect(res.status).toBe(401);
  });

  it('routes /v1/content/publish to the SDK surface', async () => {
    const res = await call('POST', '/v1/content/publish', { body: {} });
    // 401 rather than 404 proves the route is claimed and gated, without
    // needing GitHub or Bedrock to answer.
    expect(res.status).toBe(401);
  });

  it('tolerates a doubled API Gateway stage prefix', async () => {
    // Behind a `v1` stage the same call can arrive as /v1/v1/health. Getting
    // this wrong fails only in the deployed environment, so it is asserted here.
    const res = await call('GET', '/v1/v1/health');
    expect(res.status).toBe(200);
  });
});

describeDb('SDK surface — api keys, scopes, tenancy (CRDB)', () => {
  let dbRef: ReturnType<typeof createDbClient> | null = null;
  const db = () => (dbRef ??= createDbClient());

  const ownerA = `sdk-itest-a-${Date.now()}`;
  const ownerB = `sdk-itest-b-${Date.now()}`;
  const projectA = randomUUID();
  const projectB = randomUUID();
  let rwKey = '';
  let roKey = '';

  beforeAll(async () => {
    await db().query('INSERT INTO projects (id, owner_id, name) VALUES ($1::uuid, $2, $3)', [
      projectA,
      ownerA,
      'sdk-itest-a',
    ]);
    await db().query('INSERT INTO projects (id, owner_id, name) VALUES ($1::uuid, $2, $3)', [
      projectB,
      ownerB,
      'sdk-itest-b',
    ]);
    rwKey = (
      await mintApiKey({
        db: db(),
        ownerId: ownerA,
        name: 'itest-rw',
        scopes: ['memory:read', 'memory:write'],
      })
    ).key;
    roKey = (
      await mintApiKey({ db: db(), ownerId: ownerA, name: 'itest-ro', scopes: ['memory:read'] })
    ).key;
  });

  afterAll(async () => {
    if (!dbRef) return;
    await dbRef.query('DELETE FROM memory_entries WHERE project_id IN ($1::uuid, $2::uuid)', [
      projectA,
      projectB,
    ]);
    await dbRef.query('DELETE FROM api_keys WHERE owner_id IN ($1, $2)', [ownerA, ownerB]);
    await dbRef.query('DELETE FROM projects WHERE id IN ($1::uuid, $2::uuid)', [
      projectA,
      projectB,
    ]);
    await dbRef.close();
  });

  it('authenticates a minted api key', async () => {
    const res = await call('GET', '/v1/memory/entries', {
      token: rwKey,
      query: { projectId: projectA },
    });
    expect(res.status).toBe(200);
  });

  it('rejects a forged key', async () => {
    const res = await call('GET', '/v1/memory/entries', {
      token: `wc_live_${'z'.repeat(10)}_${'y'.repeat(32)}`,
      query: { projectId: projectA },
    });
    expect(res.status).toBe(401);
  });

  it('refuses cross-tenant access with 404, not 403', async () => {
    // 403 would confirm the project exists, letting a caller enumerate other
    // tenants' ids. Do not "fix" this to 403.
    const res = await call('GET', '/v1/memory/entries', {
      token: rwKey,
      query: { projectId: projectB },
    });
    expect(res.status).toBe(404);
  });

  it('enforces memory:write on the write path', async () => {
    const res = await call('POST', '/v1/memory/entries', {
      token: roKey,
      body: { projectId: projectA, text: 'should not persist' },
    });
    expect(res.status).toBe(403);
    expect(String((res.json as { error?: string }).error)).toMatch(/memory:write/);
  });

  it('refuses api-key callers on key management', async () => {
    // A leaked key must not be able to mint its own replacements.
    const res = await call('GET', '/v1/keys', { token: rwKey });
    expect(res.status).toBe(403);
    expect(String((res.json as { error?: string }).error)).toMatch(/cannot manage/i);
  });

  it('validates projectId shape before touching the database', async () => {
    const res = await call('POST', '/v1/memory/diff', {
      token: rwKey,
      body: { projectId: 'not-a-uuid', from: new Date().toISOString() },
    });
    expect(res.status).toBe(400);
  });

  it('computes a diff over AS OF SYSTEM TIME', async () => {
    const res = await call('POST', '/v1/memory/diff', {
      token: rwKey,
      body: {
        projectId: projectA,
        from: new Date(Date.now() - 10 * 60_000).toISOString(),
        to: 'now',
      },
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ added: [], retired: [], unchanged: 0 });
  });

  it('rejects a timestamp beyond the MVCC retention window with a code', async () => {
    const res = await call('POST', '/v1/memory/diff', {
      token: rwKey,
      body: { projectId: projectA, from: '2020-01-01T00:00:00Z' },
    });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ code: 'RETENTION_WINDOW_EXCEEDED' });
  });

  it('exports an empty project as a well-formed bundle', async () => {
    const res = await call('GET', '/v1/memory/export', {
      token: rwKey,
      query: { projectId: projectA },
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      format: 'walkcroach-memory-export',
      version: '1.0',
      entryCount: 0,
    });
  });

  it('requires memory:write to import', async () => {
    const res = await call('POST', '/v1/memory/import', {
      token: roKey,
      body: { projectId: projectA, bundle: { format: 'walkcroach-memory-export', version: '1.0', entries: [] } },
    });
    expect(res.status).toBe(403);
  });

  it('rejects a publish with no writeScope, before touching GitHub', async () => {
    // No default: choosing this is the caller's decision.
    const res = await call('POST', '/v1/content/publish', {
      token: rwKey,
      body: {
        projectId: projectA,
        target: { repo: 'acme/site' },
        source: { kind: 'markdown', content: '# Post' },
      },
    });
    expect(res.status).toBe(400);
    expect(String((res.json as { error?: string }).error)).toMatch(/writeScope is required/);
  });

  it('rejects an unknown writeScope mode', async () => {
    const res = await call('POST', '/v1/content/publish', {
      token: rwKey,
      body: {
        projectId: projectA,
        target: { repo: 'acme/site' },
        source: { kind: 'markdown', content: '# Post' },
        writeScope: { mode: 'anything-goes' },
      },
    });
    expect(res.status).toBe(400);
  });

  it('requires memory:write to publish', async () => {
    // Publishing writes conventions to memory as well as files to the repo.
    const res = await call('POST', '/v1/content/publish', {
      token: roKey,
      body: {
        projectId: projectA,
        target: { repo: 'acme/site' },
        source: { kind: 'markdown', content: '# Post' },
        writeScope: { mode: 'additive' },
      },
    });
    expect(res.status).toBe(403);
  });

  it('refuses cross-tenant publishing with 404', async () => {
    const res = await call('POST', '/v1/content/publish', {
      token: rwKey,
      body: {
        projectId: projectB,
        target: { repo: 'acme/site' },
        source: { kind: 'markdown', content: '# Post' },
        writeScope: { mode: 'additive' },
      },
    });
    expect(res.status).toBe(404);
  });

  it('refuses undecoded binary rather than publishing mojibake', async () => {
    // Regression: base64 was decoded straight to UTF-8. A .docx is a zip, so
    // that produced garbage and the pipeline would have built a page from it
    // and opened a PR. A garbled post that looks deliberate is far harder to
    // notice than an error.
    const docxBytes = Buffer.from('PK   fake zip').toString(
      'base64',
    );
    const res = await call('POST', '/v1/content/publish', {
      token: rwKey,
      body: {
        projectId: projectA,
        target: { repo: 'acme/site' },
        source: { kind: 'docx', content: docxBytes, encoding: 'base64' },
        writeScope: { mode: 'additive' },
      },
    });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ code: 'EXTRACTION_REQUIRED' });
  });

  it('accepts a docx supplied as already-extracted text', async () => {
    // The documented workaround until extraction ships: it must actually work.
    const res = await call('POST', '/v1/content/publish', {
      token: rwKey,
      body: {
        projectId: projectA,
        target: { repo: 'acme/site' },
        source: { kind: 'docx', content: '# Our launch\n\nReal prose.', filename: 'x.docx' },
        writeScope: { mode: 'additive' },
      },
    });
    // Past decoding; fails later for want of a GitHub installation.
    expect(res.json).toMatchObject({ code: 'GITHUB_NOT_CONNECTED' });
  });

  it('returns 404 for an unknown run', async () => {
    const res = await call('GET', `/v1/runs/${randomUUID()}`, { token: rwKey });
    expect(res.status).toBe(404);
  });

  it('rejects a malformed run id', async () => {
    const res = await call('GET', '/v1/runs/not-a-uuid', { token: rwKey });
    expect(res.status).toBe(400);
  });

  it('requires memory:write to cancel a run', async () => {
    const res = await call('DELETE', `/v1/runs/${randomUUID()}`, { token: roKey });
    expect(res.status).toBe(403);
  });

  it('rejects content that decodes to nothing', async () => {
    const res = await call('POST', '/v1/content/publish', {
      token: rwKey,
      body: {
        projectId: projectA,
        target: { repo: 'acme/site' },
        source: { kind: 'markdown', content: '   \n  ' },
        writeScope: { mode: 'additive' },
      },
    });
    expect(res.status).toBe(400);
  });

  it('explains when the project has no GitHub App installation', async () => {
    // The likeliest first-run failure, so it gets a code and an instruction
    // rather than a stack trace.
    const res = await call('POST', '/v1/content/publish', {
      token: rwKey,
      body: {
        projectId: projectA,
        target: { repo: 'acme/site' },
        source: { kind: 'markdown', content: '# Post' },
        writeScope: { mode: 'additive' },
      },
    });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ code: 'GITHUB_NOT_CONNECTED' });
  });

  it('rejects a foreign bundle format with a machine-readable code', async () => {
    const res = await call('POST', '/v1/memory/import', {
      token: rwKey,
      body: { projectId: projectA, bundle: { format: 'mem0-export', entries: [] } },
    });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ code: 'IMPORT_FORMAT_INVALID' });
  });

  it('round-trips an export through import without re-embedding', async () => {
    // The bundle carries its vectors and names the model that produced them, so
    // a matching destination reuses them — no inference call, no AWS needed.
    const embedding = Array.from({ length: 1024 }, (_, i) => Math.sin(i) / 32);
    const bundle = {
      format: 'walkcroach-memory-export',
      version: '1.0',
      exportedAt: new Date().toISOString(),
      projectId: projectA,
      embeddingModel: 'amazon.titan-embed-text-v2:0',
      embeddingDimensions: 1024,
      entryCount: 2,
      entries: [
        {
          id: 'a',
          kind: 'preference',
          text: 'itest: prefers Prisma',
          sourceSurface: 'itest',
          createdAt: '2026-08-01T00:00:00.000Z',
          supersededBy: 'b',
          embedding,
        },
        {
          id: 'b',
          kind: 'preference',
          text: 'itest: prefers Drizzle',
          sourceSurface: 'itest',
          createdAt: '2026-08-02T00:00:00.000Z',
          supersededBy: null,
          embedding,
        },
      ],
    };

    const imported = await call('POST', '/v1/memory/import', {
      token: rwKey,
      body: { projectId: projectA, bundle },
    });
    expect(imported.status).toBe(200);
    expect(imported.json).toMatchObject({ imported: 2, reEmbedded: 0, danglingSupersedes: 0 });

    // The supersede chain must survive the id remapping.
    const { rows } = await db().query<{ old_text: string; new_text: string }>(
      `SELECT a.text AS old_text, b.text AS new_text
         FROM memory_entries a JOIN memory_entries b ON a.superseded_by = b.id
        WHERE a.project_id = $1::uuid`,
      [projectA],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.old_text).toMatch(/Prisma/);
    expect(rows[0]!.new_text).toMatch(/Drizzle/);

    // And re-importing must not duplicate.
    const second = await call('POST', '/v1/memory/import', {
      token: rwKey,
      body: { projectId: projectA, bundle },
    });
    expect(second.json).toMatchObject({ imported: 0, skipped: 2 });
  });
});
