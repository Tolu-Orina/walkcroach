/**
 * Load walkcroach/{env}/runtime from Secrets Manager into process.env.
 *
 * When RUNTIME_SECRET_ARN/NAME is set (Lambda), always load and merge —
 * do not skip just because CRDB_CONNECTION_STRING is already present
 * (that footgun dropped e2b_api_key / searxng_url in mixed envs).
 * Existing process.env values win over secret keys.
 *
 * Expected JSON keys (full list: docs/runtime-secrets-and-ssm.md):
 *   crdb_connection_string
 *   crdb_mcp_api_key / crdb_mcp_cluster_id
 *   aws_bearer_token_bedrock (local only)
 *   walkcroach_api_key
 *   e2b_api_key
 *   searxng_url
 *   chrome_device_signing_key
 *   google_oauth_client_{id,secret}, slack_oauth_*, stripe_oauth_*, hubspot_oauth_*
 *   stripe_secret_key, stripe_webhook_secret, stripe_price_id_paid  (WalkCroach Billing)
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
    crdb_mcp_cluster_id?: string;
    aws_bearer_token_bedrock?: string;
    walkcroach_api_key?: string;
    e2b_api_key?: string;
    searxng_url?: string;
    chrome_device_signing_key?: string;
    google_oauth_client_id?: string;
    google_oauth_client_secret?: string;
    slack_oauth_client_id?: string;
    slack_oauth_client_secret?: string;
    stripe_oauth_client_id?: string;
    stripe_oauth_client_secret?: string;
    hubspot_oauth_client_id?: string;
    hubspot_oauth_client_secret?: string;
    stripe_secret_key?: string;
    stripe_webhook_secret?: string;
    stripe_price_id_paid?: string;
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
    'crdb_mcp_cluster_id',
    secret.crdb_mcp_cluster_id,
    'CRDB_MCP_CLUSTER_ID',
  );
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
  applySecret(
    'google_oauth_client_id',
    secret.google_oauth_client_id,
    'GOOGLE_OAUTH_CLIENT_ID',
  );
  applySecret(
    'google_oauth_client_secret',
    secret.google_oauth_client_secret,
    'GOOGLE_OAUTH_CLIENT_SECRET',
  );
  applySecret(
    'slack_oauth_client_id',
    secret.slack_oauth_client_id,
    'SLACK_OAUTH_CLIENT_ID',
  );
  applySecret(
    'slack_oauth_client_secret',
    secret.slack_oauth_client_secret,
    'SLACK_OAUTH_CLIENT_SECRET',
  );
  applySecret(
    'stripe_oauth_client_id',
    secret.stripe_oauth_client_id,
    'STRIPE_OAUTH_CLIENT_ID',
  );
  applySecret(
    'stripe_oauth_client_secret',
    secret.stripe_oauth_client_secret,
    'STRIPE_OAUTH_CLIENT_SECRET',
  );
  applySecret(
    'hubspot_oauth_client_id',
    secret.hubspot_oauth_client_id,
    'HUBSPOT_OAUTH_CLIENT_ID',
  );
  applySecret(
    'hubspot_oauth_client_secret',
    secret.hubspot_oauth_client_secret,
    'HUBSPOT_OAUTH_CLIENT_SECRET',
  );
  applySecret('stripe_secret_key', secret.stripe_secret_key, 'STRIPE_SECRET_KEY');
  applySecret(
    'stripe_webhook_secret',
    secret.stripe_webhook_secret,
    'STRIPE_WEBHOOK_SECRET',
  );
  applySecret(
    'stripe_price_id_paid',
    secret.stripe_price_id_paid,
    'STRIPE_PRICE_ID_PAID',
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
