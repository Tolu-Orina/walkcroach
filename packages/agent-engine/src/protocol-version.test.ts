/**
 * Protocol version lock (P3.9) — agent-engine CI knows Desktop PROTOCOL_VERSION.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const protocolSrc = join(
  here,
  '..',
  '..',
  'agent-protocol',
  'src',
  'index.ts',
);

describe('agent-protocol single source (P3.9)', () => {
  it('exports PROTOCOL_VERSION 3 with session-scoped resolveApproval', () => {
    const text = readFileSync(protocolSrc, 'utf8');
    expect(text).toMatch(/export const PROTOCOL_VERSION = 3/);
    expect(text).toMatch(/readonly sessionId\?: string/);
    expect(text).toMatch(/type: 'resolveApproval'/);
  });
});
