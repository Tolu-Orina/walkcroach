import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';

const TOKEN_PREFIX = 'wc1';
const DEFAULT_TTL_SEC = 30 * 24 * 60 * 60; // 30 days

export type DeviceTokenPayload = {
  sub: string;
  typ: 'chrome_device';
  iat: number;
  exp: number;
};

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

export function getDeviceSigningKey(): string {
  const key = process.env.CHROME_DEVICE_SIGNING_KEY;
  if (key && key.length >= 16) return key;
  // Opt-in only — never fall back to the hardcoded key unless ALLOW_DEV_AUTH=true.
  if (process.env.ALLOW_DEV_AUTH === 'true') {
    return 'walkcroach-chrome-dev-signing-key';
  }
  throw new Error('CHROME_DEVICE_SIGNING_KEY is required');
}

export function hashDeviceKey(deviceKey: string): string {
  return createHash('sha256').update(deviceKey, 'utf8').digest('hex');
}

export function mintDeviceKey(): string {
  return randomUUID();
}

export function mintOwnerId(): string {
  return `anon:device:${randomUUID()}`;
}

export function signDeviceToken(
  ownerId: string,
  ttlSec = DEFAULT_TTL_SEC,
): { accessToken: string; expiresIn: number; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const payload: DeviceTokenPayload = {
    sub: ownerId,
    typ: 'chrome_device',
    iat: now,
    exp: now + ttlSec,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(
    createHmac('sha256', getDeviceSigningKey()).update(body).digest(),
  );
  return {
    accessToken: `${TOKEN_PREFIX}.${body}.${sig}`,
    expiresIn: ttlSec,
    expiresAt: payload.exp,
  };
}

export function verifyDeviceToken(token: string): DeviceTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
    const body = parts[1]!;
    const sig = parts[2]!;
    const expected = b64url(
      createHmac('sha256', getDeviceSigningKey()).update(body).digest(),
    );
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(
      fromB64url(body).toString('utf8'),
    ) as DeviceTokenPayload;
    if (payload.typ !== 'chrome_device' || !payload.sub) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
