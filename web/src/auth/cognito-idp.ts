import type { CognitoTokens } from './cognito';
import { cognitoClientId, cognitoRegion } from './cognito-config';

type CognitoErrorBody = {
  __type?: string;
  message?: string;
};

export class CognitoAuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CognitoAuthError';
    this.code = code;
  }
}

async function cognitoRequest<T>(target: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://cognito-idp.${cognitoRegion()}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as T & CognitoErrorBody;
  if (!res.ok) {
    const code = data.__type?.split('#').pop() ?? 'UnknownError';
    throw new CognitoAuthError(code, data.message ?? res.statusText);
  }
  return data;
}

function toTokens(result: {
  AccessToken: string;
  IdToken: string;
  RefreshToken?: string;
  ExpiresIn: number;
}, refreshToken?: string): CognitoTokens {
  return {
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    refreshToken: result.RefreshToken ?? refreshToken ?? '',
    expiresAt: Date.now() + result.ExpiresIn * 1000,
  };
}

export async function cognitoSignUp(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<void> {
  const attributes = [{ Name: 'email', Value: input.email }];
  if (input.name?.trim()) {
    attributes.push({ Name: 'name', Value: input.name.trim() });
  }

  await cognitoRequest('SignUp', {
    ClientId: cognitoClientId(),
    Username: input.email,
    Password: input.password,
    UserAttributes: attributes,
  });
}

export async function cognitoConfirmSignUp(email: string, code: string): Promise<void> {
  await cognitoRequest('ConfirmSignUp', {
    ClientId: cognitoClientId(),
    Username: email,
    ConfirmationCode: code.trim(),
  });
}

export async function cognitoResendConfirmation(email: string): Promise<void> {
  await cognitoRequest('ResendConfirmationCode', {
    ClientId: cognitoClientId(),
    Username: email,
  });
}

export async function cognitoSignIn(
  email: string,
  password: string,
): Promise<CognitoTokens> {
  const data = await cognitoRequest<{
    AuthenticationResult: {
      AccessToken: string;
      IdToken: string;
      RefreshToken: string;
      ExpiresIn: number;
    };
  }>('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: cognitoClientId(),
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  });

  if (!data.AuthenticationResult) {
    throw new CognitoAuthError('AuthError', 'Sign-in did not return tokens');
  }

  return toTokens(data.AuthenticationResult);
}

export async function cognitoForgotPassword(email: string): Promise<void> {
  await cognitoRequest('ForgotPassword', {
    ClientId: cognitoClientId(),
    Username: email,
  });
}

export async function cognitoConfirmForgotPassword(
  email: string,
  code: string,
  password: string,
): Promise<void> {
  await cognitoRequest('ConfirmForgotPassword', {
    ClientId: cognitoClientId(),
    Username: email,
    ConfirmationCode: code.trim(),
    Password: password,
  });
}

export async function cognitoRefreshTokens(refreshToken: string): Promise<CognitoTokens> {
  const data = await cognitoRequest<{
    AuthenticationResult: {
      AccessToken: string;
      IdToken: string;
      ExpiresIn: number;
    };
  }>('InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: cognitoClientId(),
    AuthParameters: {
      REFRESH_TOKEN: refreshToken,
    },
  });

  if (!data.AuthenticationResult) {
    throw new CognitoAuthError('AuthError', 'Token refresh failed');
  }

  return toTokens(data.AuthenticationResult, refreshToken);
}

export function cognitoErrorMessage(err: unknown): string {
  if (err instanceof CognitoAuthError) {
    switch (err.code) {
      case 'UserNotConfirmedException':
        return 'Confirm your email before signing in.';
      case 'NotAuthorizedException':
        return 'Incorrect email or password.';
      case 'UsernameExistsException':
        return 'An account with this email already exists.';
      case 'InvalidPasswordException':
        return 'Password does not meet requirements (8+ chars, upper, lower, number).';
      case 'CodeMismatchException':
        return 'Invalid verification code.';
      case 'ExpiredCodeException':
        return 'Verification code expired. Request a new one.';
      case 'LimitExceededException':
        return 'Too many attempts. Wait a moment and try again.';
      case 'UserNotFoundException':
        return 'No account found for this email.';
      default:
        return err.message;
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
