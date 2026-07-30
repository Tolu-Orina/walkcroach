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

describe('message contract', () => {
  it('keeps the page-access messages the side panel depends on', () => {
    // Renaming or dropping one of these silently breaks the panel: sendMessage
    // to an unknown type is rejected by the worker with { ok: false }.
    for (const required of [
      'GET_PAGE_CONTEXT',
      'WARM_PAGE_CONTEXT',
      'GET_ACTIVE_EXTRACT',
      'GET_GRANTED_ORIGINS',
      'REVOKE_ORIGIN',
      'CLEAR_PAGE_CACHE',
    ]) {
      expect(MESSAGE_TYPES as readonly string[]).toContain(required);
    }
  });

  it('still rejects anything outside the allowlist', () => {
    expect(isAllowedMessage({ type: 'GET_PAGE_CONTEXT_EVIL' })).toBe(false);
    expect(isAllowedMessage({ type: 'executeScript' })).toBe(false);
  });
});
