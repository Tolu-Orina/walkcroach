import { describe, expect, it } from 'vitest';
import {
  hashDeviceKey,
  mintOwnerId,
  signDeviceToken,
  verifyDeviceToken,
} from './device-token.js';
import { normalizeChromePath } from './handlers/rest.js';

describe('device-token', () => {
  it('round-trips a signed device token', () => {
    process.env.ALLOW_DEV_AUTH = 'true';
    delete process.env.CHROME_DEVICE_SIGNING_KEY;
    const ownerId = mintOwnerId();
    const { accessToken } = signDeviceToken(ownerId, 3600);
    const payload = verifyDeviceToken(accessToken);
    expect(payload?.sub).toBe(ownerId);
    expect(payload?.typ).toBe('chrome_device');
  });

  it('rejects tampered tokens', () => {
    process.env.ALLOW_DEV_AUTH = 'true';
    const { accessToken } = signDeviceToken(mintOwnerId(), 3600);
    const tampered = accessToken.slice(0, -4) + 'xxxx';
    expect(verifyDeviceToken(tampered)).toBeNull();
  });

  it('hashes device keys stably', () => {
    expect(hashDeviceKey('abc')).toBe(hashDeviceKey('abc'));
    expect(hashDeviceKey('abc')).not.toBe(hashDeviceKey('abd'));
  });
});

describe('normalizeChromePath', () => {
  it('strips stage prefix', () => {
    expect(normalizeChromePath('/v1/chrome/v1/health')).toBe(
      '/chrome/v1/health',
    );
    expect(normalizeChromePath('/chrome/v1/health')).toBe('/chrome/v1/health');
  });
});
