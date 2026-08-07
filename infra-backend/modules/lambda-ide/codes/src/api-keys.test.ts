import { afterAll, describe, expect, it } from 'vitest';
import { createDbClient, loadEnv } from '@walkcroach/db';

// This suite needs a database and nothing else — no Bedrock, no AWS. Loading
// `.env` here (rather than in the shared setup) means these tests actually run
// for a developer with a cluster, without un-skipping the Bedrock-dependent
// suites that would fail on a machine with no AWS credentials.
loadEnv(process.cwd());
import {
  ALL_SCOPES,
  hasScope,
  isApiKey,
  listApiKeys,
  mintApiKey,
  parseApiKey,
  revokeApiKey,
  verifyApiKey,
} from './api-keys.js';
import { hasCrdb } from './test/ide-api.harness.js';

describe('api key format', () => {
  it('recognises live keys by prefix', () => {
    expect(isApiKey('wc_live_abc')).toBe(true);
    expect(isApiKey('eyJhbGciOi')).toBe(false);
    expect(isApiKey('dev:someone')).toBe(false);
  });

  it('parses a well-formed key into prefix and secret', () => {
    const key = `wc_live_${'a'.repeat(10)}_${'b'.repeat(32)}`;
    expect(parseApiKey(key)).toEqual({
      prefix: `wc_live_${'a'.repeat(10)}`,
      secret: 'b'.repeat(32),
    });
  });

  it.each([
    ['wc_live_short', 'handle too short'],
    [`wc_live_${'a'.repeat(10)}_${'b'.repeat(31)}`, 'secret too short'],
    [`wc_live_${'a'.repeat(11)}_${'b'.repeat(32)}`, 'handle too long'],
    ['wc_live_', 'empty'],
    ['not-a-key', 'wrong prefix'],
  ])('rejects malformed key (%s / %s)', (key) => {
    expect(parseApiKey(key)).toBeNull();
  });
});

describe('scope checks', () => {
  it('treats undefined scopes as an unrestricted Cognito user', () => {
    // Scopes only ever narrow an API key. A signed-in user has none and must
    // not be restricted by their absence.
    expect(hasScope(undefined, 'memory:write')).toBe(true);
  });

  it('narrows an API key to exactly its granted scopes', () => {
    expect(hasScope(['memory:read'], 'memory:read')).toBe(true);
    expect(hasScope(['memory:read'], 'memory:write')).toBe(false);
    expect(hasScope([], 'memory:read')).toBe(false);
  });

  it('exposes memory and content scopes', () => {
    expect([...ALL_SCOPES]).toEqual([
      'memory:read',
      'memory:write',
      'content:run',
    ]);
  });
});

const describeDb = hasCrdb() ? describe : describe.skip;

describeDb('api key lifecycle (CRDB)', () => {
  // Lazy: `describe.skip` still evaluates this body during collection, so
  // constructing the client eagerly would throw on a machine with no cluster,
  // turning an intended skip into a suite failure.
  let dbRef: ReturnType<typeof createDbClient> | null = null;
  const db = () => (dbRef ??= createDbClient());

  const ownerA = `test-key-a-${Date.now()}`;
  const ownerB = `test-key-b-${Date.now()}`;

  afterAll(async () => {
    if (!dbRef) return;
    await dbRef.query('DELETE FROM api_keys WHERE owner_id IN ($1, $2)', [ownerA, ownerB]);
    await dbRef.close();
  });

  it('mints a key that verifies to its owner', async () => {
    const minted = await mintApiKey({
      db: db(),
      ownerId: ownerA,
      name: 'sdk',
      scopes: ['memory:read', 'memory:write'],
    });
    expect(minted.key.startsWith('wc_live_')).toBe(true);

    const ctx = await verifyApiKey(db(), minted.key);
    expect(ctx?.ownerId).toBe(ownerA);
    expect(ctx?.scopes).toContain('memory:write');
  });

  it('never persists the raw secret', async () => {
    const minted = await mintApiKey({ db: db(), ownerId: ownerA, name: 'leak-probe' });
    const secret = minted.key.slice(minted.prefix.length + 1);

    const { rows } = await db().query<{ key_hash: Buffer }>(
      'SELECT key_hash FROM api_keys WHERE id = $1',
      [minted.id],
    );
    // Checked in both encodings: a hash that happened to contain the ASCII
    // bytes would be just as much of a leak as a plaintext column.
    expect(rows[0]!.key_hash.toString('latin1')).not.toContain(secret);
    expect(rows[0]!.key_hash.toString('hex')).not.toContain(
      Buffer.from(secret).toString('hex'),
    );
  });

  it('rejects a tampered secret, unknown prefix, and malformed token alike', async () => {
    const minted = await mintApiKey({ db: db(), ownerId: ownerA, name: 'adversarial' });
    expect(await verifyApiKey(db(), `${minted.key.slice(0, -1)}X`)).toBeNull();
    expect(await verifyApiKey(db(), `wc_live_${'z'.repeat(10)}_${'y'.repeat(32)}`)).toBeNull();
    expect(await verifyApiKey(db(), 'wc_live_nope')).toBeNull();
  });

  it('rejects an expired key', async () => {
    const minted = await mintApiKey({
      db: db(),
      ownerId: ownerA,
      name: 'expired',
      expiresAt: new Date(Date.now() - 1_000),
    });
    expect(await verifyApiKey(db(), minted.key)).toBeNull();
  });

  it('will not let one owner revoke another owner key', async () => {
    const minted = await mintApiKey({ db: db(), ownerId: ownerA, name: 'cross-revoke' });
    expect(await revokeApiKey({ db: db(), ownerId: ownerB, id: minted.id })).toBe(false);
    // Still usable: the failed revoke must not have degraded it.
    expect((await verifyApiKey(db(), minted.key))?.ownerId).toBe(ownerA);
  });

  it('revokes idempotently and stops accepting the key', async () => {
    const minted = await mintApiKey({ db: db(), ownerId: ownerA, name: 'revoke-me' });
    expect(await revokeApiKey({ db: db(), ownerId: ownerA, id: minted.id })).toBe(true);
    expect(await verifyApiKey(db(), minted.key)).toBeNull();
    expect(await revokeApiKey({ db: db(), ownerId: ownerA, id: minted.id })).toBe(false);
  });

  it('scopes listing to the owner and omits secret material', async () => {
    const minted = await mintApiKey({ db: db(), ownerId: ownerA, name: 'listed' });
    const secret = minted.key.slice(minted.prefix.length + 1);

    const mine = await listApiKeys({ db: db(), ownerId: ownerA });
    expect(mine.length).toBeGreaterThan(0);
    expect(JSON.stringify(mine)).not.toContain(secret);

    expect(await listApiKeys({ db: db(), ownerId: ownerB })).toHaveLength(0);
  });
});
