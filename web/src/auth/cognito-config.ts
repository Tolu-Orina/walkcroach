export function cognitoClientId(): string {
  return String(import.meta.env.VITE_COGNITO_CLIENT_ID ?? '');
}

export function cognitoRegion(): string {
  return String(import.meta.env.VITE_COGNITO_REGION ?? '');
}

export function isCognitoEnabled(): boolean {
  return Boolean(cognitoClientId() && cognitoRegion());
}

export function allowDevAuth(): boolean {
  return import.meta.env.VITE_ALLOW_DEV_AUTH === 'true';
}
