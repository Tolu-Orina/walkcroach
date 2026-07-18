import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CognitoAuthError,
  cognitoConfirmForgotPassword,
  cognitoConfirmSignUp,
  cognitoErrorMessage,
  cognitoForgotPassword,
  cognitoRefreshTokens,
  cognitoResendConfirmation,
  cognitoSignIn,
  cognitoSignUp,
} from './cognito-idp';

describe('cognitoErrorMessage', () => {
  it('maps UserNotConfirmedException', () => {
    const msg = cognitoErrorMessage(
      new CognitoAuthError('UserNotConfirmedException', 'raw'),
    );
    expect(msg).toContain('Confirm your email');
  });

  it('maps NotAuthorizedException', () => {
    const msg = cognitoErrorMessage(
      new CognitoAuthError('NotAuthorizedException', 'raw'),
    );
    expect(msg).toContain('Incorrect email or password');
  });

  it('maps UsernameExistsException', () => {
    const msg = cognitoErrorMessage(
      new CognitoAuthError('UsernameExistsException', 'raw'),
    );
    expect(msg).toContain('already exists');
  });

  it('maps InvalidPasswordException', () => {
    const msg = cognitoErrorMessage(
      new CognitoAuthError('InvalidPasswordException', 'raw'),
    );
    expect(msg).toContain('Password does not meet');
  });

  it('maps CodeMismatchException', () => {
    const msg = cognitoErrorMessage(
      new CognitoAuthError('CodeMismatchException', 'raw'),
    );
    expect(msg).toContain('Invalid verification');
  });

  it('maps ExpiredCodeException', () => {
    const msg = cognitoErrorMessage(
      new CognitoAuthError('ExpiredCodeException', 'raw'),
    );
    expect(msg).toContain('expired');
  });

  it('maps LimitExceededException', () => {
    const msg = cognitoErrorMessage(
      new CognitoAuthError('LimitExceededException', 'raw'),
    );
    expect(msg).toContain('Too many attempts');
  });

  it('maps UserNotFoundException', () => {
    const msg = cognitoErrorMessage(
      new CognitoAuthError('UserNotFoundException', 'raw'),
    );
    expect(msg).toContain('No account found');
  });

  it('falls back to raw message for unknown code', () => {
    expect(cognitoErrorMessage(new CognitoAuthError('SomethingElse', 'oops'))).toBe(
      'oops',
    );
  });

  it('passes through generic errors', () => {
    expect(cognitoErrorMessage(new Error('network'))).toBe('network');
  });

  it('stringifies non-Error values', () => {
    expect(cognitoErrorMessage(42)).toBe('42');
  });
});

describe('CognitoAuthError', () => {
  it('has correct name and code', () => {
    const err = new CognitoAuthError('CodeMismatchException', 'bad code');
    expect(err.name).toBe('CognitoAuthError');
    expect(err.code).toBe('CodeMismatchException');
    expect(err.message).toBe('bad code');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('cognitoSignIn', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'testclient');
    vi.stubEnv('VITE_COGNITO_REGION', 'us-east-1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns tokens on success', async () => {
    const mockResponse = {
      AuthenticationResult: {
        AccessToken: 'at',
        IdToken: 'it',
        RefreshToken: 'rt',
        ExpiresIn: 3600,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }),
    );

    const tokens = await cognitoSignIn('user@test.com', 'pass');
    expect(tokens.accessToken).toBe('at');
    expect(tokens.idToken).toBe('it');
    expect(tokens.refreshToken).toBe('rt');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it('throws CognitoAuthError on API error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        json: () =>
          Promise.resolve({
            __type: 'com.amazonaws.cognito#NotAuthorizedException',
            message: 'Incorrect username or password.',
          }),
      }),
    );

    await expect(cognitoSignIn('user@test.com', 'wrong')).rejects.toThrow(
      CognitoAuthError,
    );
  });

  it('throws when AuthenticationResult is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      }),
    );
    await expect(cognitoSignIn('u@t.com', 'p')).rejects.toThrow('Sign-in did not return tokens');
  });
});

describe('cognitoSignUp', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'testclient');
    vi.stubEnv('VITE_COGNITO_REGION', 'us-east-1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sends SignUp request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
    await cognitoSignUp({ email: 'a@b.c', password: 'Pass1234' });
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.Username).toBe('a@b.c');
  });

  it('includes name attribute when provided', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
    await cognitoSignUp({ email: 'a@b.c', password: 'P', name: 'Alice' });
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.UserAttributes).toEqual(
      expect.arrayContaining([{ Name: 'name', Value: 'Alice' }]),
    );
  });
});

describe('cognitoConfirmSignUp', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'testclient');
    vi.stubEnv('VITE_COGNITO_REGION', 'us-east-1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sends ConfirmSignUp request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
    await cognitoConfirmSignUp('a@b.c', '123456');
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.ConfirmationCode).toBe('123456');
  });
});

describe('cognitoResendConfirmation', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'testclient');
    vi.stubEnv('VITE_COGNITO_REGION', 'us-east-1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sends ResendConfirmationCode request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
    await cognitoResendConfirmation('a@b.c');
    const headers = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers['x-amz-target']).toContain('ResendConfirmationCode');
  });
});

describe('cognitoForgotPassword', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'testclient');
    vi.stubEnv('VITE_COGNITO_REGION', 'us-east-1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sends ForgotPassword request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
    await cognitoForgotPassword('a@b.c');
    const headers = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers['x-amz-target']).toContain('ForgotPassword');
  });
});

describe('cognitoConfirmForgotPassword', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'testclient');
    vi.stubEnv('VITE_COGNITO_REGION', 'us-east-1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sends ConfirmForgotPassword request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
    await cognitoConfirmForgotPassword('a@b.c', '111', 'NewPass1');
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.Password).toBe('NewPass1');
    expect(body.ConfirmationCode).toBe('111');
  });
});

describe('cognitoRefreshTokens', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'testclient');
    vi.stubEnv('VITE_COGNITO_REGION', 'us-east-1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refreshes tokens', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        AuthenticationResult: {
          AccessToken: 'at2',
          IdToken: 'it2',
          ExpiresIn: 3600,
        },
      }),
    }));
    const tokens = await cognitoRefreshTokens('rt-old');
    expect(tokens.accessToken).toBe('at2');
    expect(tokens.refreshToken).toBe('rt-old');
  });

  it('throws when result is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    }));
    await expect(cognitoRefreshTokens('rt')).rejects.toThrow('Token refresh failed');
  });
});
