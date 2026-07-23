import { describe, expect, it } from 'vitest';
import { ideRedirectUri } from './session.js';

describe('ideRedirectUri', () => {
  it('uses vscode scheme by default from mock', () => {
    expect(ideRedirectUri()).toBe('vscode://walkcroach.walkcroach-ide/auth');
  });

  it('builds cursor deep link when scheme is cursor', () => {
    expect(ideRedirectUri('cursor')).toBe(
      'cursor://walkcroach.walkcroach-ide/auth',
    );
  });

  it('supports vscode-insiders', () => {
    expect(ideRedirectUri('vscode-insiders')).toBe(
      'vscode-insiders://walkcroach.walkcroach-ide/auth',
    );
  });
});
