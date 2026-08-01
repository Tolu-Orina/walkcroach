/**
 * Load walkcroach/{env}/runtime from Secrets Manager into process.env.
 * When RUNTIME_SECRET_ARN is set, always merge (existing env wins).
 */
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

let loaded = false;

function applySecret(value: string | undefined, envName: string): void {
  if (!value) return;
  if (!process.env[envName]) process.env[envName] = value;
}

export async function ensureRuntimeSecrets(): Promise<void> {
  if (loaded) return;

  const secretId =
    process.env.RUNTIME_SECRET_ARN ?? process.env.RUNTIME_SECRET_NAME;

  if (!secretId) {
    if (process.env.CRDB_CONNECTION_STRING) {
      loaded = true;
      return;
    }
    throw new Error(
      'CRDB_CONNECTION_STRING or RUNTIME_SECRET_ARN is required in Lambda',
    );
  }

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? process.env.BEDROCK_REGION ?? 'eu-west-2',
  });

  const raw = await client.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  const secret = JSON.parse(raw.SecretString ?? '{}') as {
    crdb_connection_string?: string;
    chrome_device_signing_key?: string;
    walkcroach_api_key?: string;
    aws_bearer_token_bedrock?: string;
    searxng_url?: string;
    chrome_site_profiles_bundle?: string;
    chrome_site_profiles_signature?: string;
  };

  applySecret(secret.crdb_connection_string, 'CRDB_CONNECTION_STRING');
  if (!process.env.CRDB_CONNECTION_STRING) {
    throw new Error(`Secret ${secretId} missing crdb_connection_string`);
  }

  applySecret(secret.chrome_device_signing_key, 'CHROME_DEVICE_SIGNING_KEY');
  if (!process.env.CHROME_DEVICE_SIGNING_KEY && secret.walkcroach_api_key) {
    process.env.CHROME_DEVICE_SIGNING_KEY = secret.walkcroach_api_key;
  }

  applySecret(secret.searxng_url, 'SEARXNG_URL');

  /*
    Signed site-profile bundle (Phase D6).

    Neither value is actually secret — both are served verbatim to any client
    that asks. They live here purely because of size: the bundle alone is ~3.6
    KB against Lambda's 4 KB limit for ALL environment variables combined, so it
    cannot be a Terraform env var without crowding out the rest and breaking
    again the first time a profile is added. Secrets Manager allows 64 KB.

    The private half of the keypair never appears here, or anywhere in AWS —
    bundles are signed offline by chrome/scripts/sign-profiles.mjs.

    Absent, handleSiteProfiles returns 404 and every extension keeps its
    packaged profiles, which is the correct unconfigured state.
  */
  applySecret(secret.chrome_site_profiles_bundle, 'CHROME_SITE_PROFILES_BUNDLE');
  applySecret(
    secret.chrome_site_profiles_signature,
    'CHROME_SITE_PROFILES_SIGNATURE',
  );

  if (
    secret.aws_bearer_token_bedrock &&
    !process.env.AWS_LAMBDA_FUNCTION_NAME &&
    !process.env.AWS_BEARER_TOKEN_BEDROCK
  ) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = secret.aws_bearer_token_bedrock;
  } else if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
  }

  loaded = true;
}
