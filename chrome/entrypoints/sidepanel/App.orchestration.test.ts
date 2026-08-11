/**
 * App orchestration contracts for production-readiness residuals.
 */
import { describe, it, expect } from 'vitest';
import { workspaceIdForPendingSave } from '../../lib/selection-claim';
import { classifyCognitoJwt } from '../../lib/cognito-jwt';
import {
  describeSessionSource,
  shortenSessionRef,
} from './App';

describe('App orchestration — pending selection workspace', () => {
  it('requires ensureNamed when the panel has no active workspace', async () => {
    let called = false;
    const id = await workspaceIdForPendingSave({
      activeWs: undefined,
      fallbackName: 'General',
      ensureNamed: async () => {
        called = true;
        return 'ws-created';
      },
    });
    expect(called).toBe(true);
    expect(id).toBe('ws-created');
  });

  it('does not call ensureNamed when an active workspace is set', async () => {
    let called = false;
    const id = await workspaceIdForPendingSave({
      activeWs: 'ws-live',
      fallbackName: 'General',
      ensureNamed: async () => {
        called = true;
        return 'ws-created';
      },
    });
    expect(called).toBe(false);
    expect(id).toBe('ws-live');
  });
});

describe('App orchestration — Cognito token slots', () => {
  it('keeps access and id token_use distinct for storage', () => {
    const access = `e30.${btoa(JSON.stringify({ token_use: 'access' })).replace(/=+$/, '')}.x`;
    const id = `e30.${btoa(JSON.stringify({ token_use: 'id' })).replace(/=+$/, '')}.x`;
    expect(classifyCognitoJwt(access)).toBe('access');
    expect(classifyCognitoJwt(id)).toBe('id');
    expect(classifyCognitoJwt('raw-opaque')).toBe('opaque');
  });

  it('never classifies an id JWT as access (SDK slot guard)', () => {
    const id = `e30.${btoa(JSON.stringify({ token_use: 'id' })).replace(/=+$/, '')}.x`;
    expect(classifyCognitoJwt(id)).toBe('id');
  });
});

describe('App orchestration — session copy for non-devs', () => {
  it('names the session in plain language', () => {
    expect(describeSessionSource('cognito')).toMatch(/WalkCroach account/);
    expect(describeSessionSource('device')).toMatch(/Device session/);
    expect(describeSessionSource(undefined)).toMatch(/Device session/);
  });

  it('shortens the support ref without losing the full id on title', () => {
    expect(shortenSessionRef('abcdefghijklmnop')).toBe('abcdefgh…');
    expect(shortenSessionRef('short')).toBe('short');
  });
});
