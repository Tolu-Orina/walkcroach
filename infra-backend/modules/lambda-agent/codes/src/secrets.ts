/**
 * Load walkcroach/{env}/runtime from Secrets Manager into process.env.
 *
 * When RUNTIME_SECRET_ARN/NAME is set (Lambda), always load and merge —
 * do not skip just because CRDB_CONNECTION_STRING is already present
 * (that footgun dropped e2b_api_key / searxng_url in mixed envs).
 * Existing process.env values win over secret keys.
 *
 * Expected JSON keys:
 *   crdb_connection_string
 *   crdb_mcp_api_key
 *   aws_bearer_token_bedrock
 *   walkcroach_api_key
 *   e2b_api_key          (App Builder sandbox — locked runtime)
 *   searxng_url          (optional; web_search tool)
 *   chrome_device_signing_key (optional; Chrome BFF reads via its own loader)
 */
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

let loaded = false;

function applySecret(
  key: string,
  value: string | undefined,
  envName: string,
): void {
  if (!value) return;
  if (!process.env[envName]) {
    process.env[envName] = value;
  }
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
    crdb_mcp_api_key?: string;
    aws_bearer_token_bedrock?: string;
    walkcroach_api_key?: string;
    e2b_api_key?: string;
    searxng_url?: string;
    chrome_device_signing_key?: string;
  };

  applySecret(
    'crdb_connection_string',
    secret.crdb_connection_string,
    'CRDB_CONNECTION_STRING',
  );
  if (!process.env.CRDB_CONNECTION_STRING) {
    throw new Error(`Secret ${secretId} missing crdb_connection_string`);
  }

  applySecret('crdb_mcp_api_key', secret.crdb_mcp_api_key, 'CRDB_MCP_API_KEY');
  applySecret(
    'walkcroach_api_key',
    secret.walkcroach_api_key,
    'WALKCROACH_API_KEY',
  );
  applySecret('e2b_api_key', secret.e2b_api_key, 'E2B_API_KEY');
  applySecret('searxng_url', secret.searxng_url, 'SEARXNG_URL');
  applySecret(
    'chrome_device_signing_key',
    secret.chrome_device_signing_key,
    'CHROME_DEVICE_SIGNING_KEY',
  );

  // Lambda uses the execution role for Bedrock (IAM). Bearer tokens expire (~12h)
  // and override IAM when set — only use them for local dev.
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
