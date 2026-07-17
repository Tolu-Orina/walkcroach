import { describe, expect, it } from 'vitest';
import { CognitoAuthError, cognitoErrorMessage } from './cognito-idp';

describe('cognitoErrorMessage', () => {
  it('maps UserNotConfirmedException', () => {
    const msg = cognitoErrorMessage(
      new CognitoAuthError('UserNotConfirmedException', 'raw'),
    );
    expect(msg).toContain('Confirm your email');
  });

  it('passes through generic errors', () => {
    expect(cognitoErrorMessage(new Error('network'))).toBe('network');
  });
});
