import { describe, expect, it } from 'vitest';
import {
  decodeGithubOAuthState,
  encodeGithubOAuthState,
} from './github-oauth.js';

describe('github-oauth state', () => {
  it('round-trips state payload', () => {
    const payload = {
      projectId: '00000000-0000-4000-8000-000000000099',
      ownerId: 'user:test',
      repo: 'acme/demo',
      nonce: 'nonce-1',
    };
    const encoded = encodeGithubOAuthState(payload);
    expect(decodeGithubOAuthState(encoded)).toEqual(payload);
  });
});
