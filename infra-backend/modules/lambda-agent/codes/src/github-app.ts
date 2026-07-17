import { createSign } from 'node:crypto';
import { getGithubAppConfig } from './github-config.js';

type InstallationTokenCache = {
  token: string;
  expiresAt: number;
};

const installationTokens = new Map<number, InstallationTokenCache>();

function base64Url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function createGithubAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 600,
      iss: appId,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  sign.end();
  const signature = sign.sign(privateKeyPem);
  return `${signingInput}.${base64Url(signature)}`;
}

export async function getInstallationAccessToken(
  installationId: number,
): Promise<string> {
  const cached = installationTokens.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const config = await getGithubAppConfig();
  if (!config) {
    throw new Error('GitHub App is not configured');
  }

  const jwt = createGithubAppJwt(config.appId, config.privateKeyPem);
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${jwt}`,
        'x-github-api-version': '2022-11-28',
      },
    },
  );

  if (!res.ok) {
    throw new Error(`GitHub installation token failed: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    token: string;
    expires_at: string;
  };

  installationTokens.set(installationId, {
    token: data.token,
    expiresAt: new Date(data.expires_at).getTime(),
  });

  return data.token;
}

export function buildGithubInstallUrl(appSlug: string, state: string): string {
  const params = new URLSearchParams({ state });
  return `https://github.com/apps/${appSlug}/installations/new?${params}`;
}
