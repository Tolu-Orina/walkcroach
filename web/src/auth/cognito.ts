export type CognitoTokens = {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
};

export {
  allowDevAuth,
  cognitoClientId,
  cognitoRegion,
  isCognitoEnabled,
} from './cognito-config';

export { cognitoRefreshTokens as refreshCognitoTokens } from './cognito-idp';

export function parseIdToken(idToken: string): {
  sub: string;
  email?: string;
  name?: string;
} {
  const payload = idToken.split('.')[1];
  if (!payload) throw new Error('invalid id token');
  const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
    sub?: string;
    email?: string;
    name?: string;
  };
  if (!json.sub) throw new Error('id token missing sub');
  return { sub: json.sub, email: json.email, name: json.name };
}
