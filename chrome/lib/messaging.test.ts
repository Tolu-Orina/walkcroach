import { describe, expect, it, beforeEach, vi } from 'vitest';
import { isAllowedMessage, isTrustedSender, MESSAGE_TYPES } from './messaging';

beforeEach(() => {
  globalThis.chrome = {
    storage: {
      local: {} as chrome.storage.LocalStorageArea,
      session: {} as chrome.storage.SessionStorageArea,
    },
    runtime: { id: 'ext-id' },
    permissions: {} as typeof chrome.permissions,
  } as unknown as typeof chrome;
});

describe('messaging allowlist', () => {
  it('accepts known types', () => {
    for (const type of MESSAGE_TYPES) {
      expect(isAllowedMessage({ type })).toBe(true);
    }
  });

  it('rejects unknown types', () => {
    expect(isAllowedMessage({ type: 'RUN_ARBITRARY' })).toBe(false);
    expect(isAllowedMessage({})).toBe(false);
    expect(isAllowedMessage(null)).toBe(false);
  });

  it('rejects non-object values', () => {
    expect(isAllowedMessage(42)).toBe(false);
    expect(isAllowedMessage('string')).toBe(false);
    expect(isAllowedMessage(undefined)).toBe(false);
  });
});

describe('isTrustedSender', () => {
  it('returns true when sender id matches runtime id', () => {
    const sender = { id: 'ext-id' } as chrome.runtime.MessageSender;
    expect(isTrustedSender(sender)).toBe(true);
  });

  it('returns false when sender id differs', () => {
    const sender = { id: 'other-ext' } as chrome.runtime.MessageSender;
    expect(isTrustedSender(sender)).toBe(false);
  });

  it('returns false when sender id is undefined', () => {
    const sender = {} as chrome.runtime.MessageSender;
    expect(isTrustedSender(sender)).toBe(false);
  });
});
