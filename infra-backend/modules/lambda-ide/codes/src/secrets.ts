/**
 * Load walkcroach/{env}/runtime from Secrets Manager into process.env.
 * No-op when CRDB_CONNECTION_STRING is already set (local `.env`).
 */
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

let loaded = false;

export async function ensureRuntimeSecrets(): Promise<void> {
  if (loaded) return;
  if (process.env.CRDB_CONNECTION_STRING) {
    loaded = true;
    return;
  }

  const secretId =
    process.env.RUNTIME_SECRET_ARN ?? process.env.RUNTIME_SECRET_NAME;
  if (!secretId) {
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
    aws_bearer_token_bedrock?: string;
  };

  if (!secret.crdb_connection_string) {
    throw new Error(`Secret ${secretId} missing crdb_connection_string`);
  }

  process.env.CRDB_CONNECTION_STRING = secret.crdb_connection_string;
  if (
    secret.aws_bearer_token_bedrock &&
    !process.env.AWS_LAMBDA_FUNCTION_NAME
  ) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = secret.aws_bearer_token_bedrock;
  } else {
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
  }

  loaded = true;
}
