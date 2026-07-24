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
  };

  applySecret(secret.crdb_connection_string, 'CRDB_CONNECTION_STRING');
  if (!process.env.CRDB_CONNECTION_STRING) {
    throw new Error(`Secret ${secretId} missing crdb_connection_string`);
  }

  applySecret(secret.chrome_device_signing_key, 'CHROME_DEVICE_SIGNING_KEY');
  if (!process.env.CHROME_DEVICE_SIGNING_KEY && secret.walkcroach_api_key) {
    process.env.CHROME_DEVICE_SIGNING_KEY = secret.walkcroach_api_key;
  }

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
