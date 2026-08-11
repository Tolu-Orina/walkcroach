import { describe, it, expect } from 'vitest';
import { classifyCognitoJwt } from './cognito-jwt';

function fakeJwt(payload: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `hdr.${body}.sig`;
}

describe('classifyCognitoJwt', () => {
  it('detects access tokens', () => {
    expect(classifyCognitoJwt(fakeJwt({ token_use: 'access' }))).toBe(
      'access',
    );
  });

  it('detects id tokens', () => {
    expect(classifyCognitoJwt(fakeJwt({ token_use: 'id' }))).toBe('id');
  });

  it('treats non-JWTs as opaque', () => {
    expect(classifyCognitoJwt('not-a-jwt')).toBe('opaque');
  });
});
