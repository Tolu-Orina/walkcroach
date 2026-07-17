import {
  GetParameterCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';

export type GithubAppConfig = {
  appId: string;
  clientId: string;
  appSlug: string;
  privateKeyPem: string;
};

let cached: GithubAppConfig | null | undefined;
let loadPromise: Promise<GithubAppConfig | null> | null = null;

function ssmPrefix(): string {
  const env = process.env.ENVIRONMENT ?? 'dev';
  const prefix = process.env.GITHUB_SSM_PREFIX?.trim();
  if (prefix) return prefix.replace(/\/$/, '');
  return `walkcroach/${env}/github`;
}

function paramName(suffix: string): string {
  const base = ssmPrefix();
  return base.startsWith('/') ? `${base}/${suffix}` : `/${base}/${suffix}`;
}

function fromEnv(): GithubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim();
  const appSlug = process.env.GITHUB_APP_SLUG?.trim();
  const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (!appId || !clientId || !appSlug || !privateKeyPem) return null;
  return { appId, clientId, appSlug, privateKeyPem };
}

async function readParam(
  client: SSMClient,
  name: string,
  withDecryption: boolean,
): Promise<string | null> {
  try {
    const res = await client.send(
      new GetParameterCommand({ Name: name, WithDecryption: withDecryption }),
    );
    return res.Parameter?.Value?.trim() ?? null;
  } catch {
    return null;
  }
}

async function loadFromSsm(): Promise<GithubAppConfig | null> {
  const client = new SSMClient({
    region: process.env.AWS_REGION ?? process.env.BEDROCK_REGION ?? 'eu-west-2',
  });

  const [appId, clientId, appSlug, privateKeyPem] = await Promise.all([
    readParam(client, paramName('app_id'), false),
    readParam(client, paramName('client_id'), false),
    readParam(client, paramName('app_slug'), false),
    readParam(client, paramName('app_private_key'), true).then(
      async (v) => v ?? readParam(client, paramName('private_key'), true),
    ),
  ]);

  if (!appId || !clientId || !appSlug || !privateKeyPem) return null;
  return { appId, clientId, appSlug, privateKeyPem };
}

export async function getGithubAppConfig(): Promise<GithubAppConfig | null> {
  if (cached !== undefined) return cached;
  if (!loadPromise) {
    loadPromise = (async () => {
      const envConfig = fromEnv();
      if (envConfig) {
        cached = envConfig;
        return envConfig;
      }
      const ssmConfig = await loadFromSsm();
      cached = ssmConfig;
      return ssmConfig;
    })();
  }
  return loadPromise;
}

export async function isGithubAppEnabled(): Promise<boolean> {
  return (await getGithubAppConfig()) !== null;
}

export function resetGithubAppConfigCache(): void {
  cached = undefined;
  loadPromise = null;
}
