import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

const LOCAL_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.local-secrets',
);

function sm(): SecretsManagerClient {
  return new SecretsManagerClient({
    region: process.env.AWS_REGION ?? process.env.BEDROCK_REGION ?? 'eu-west-2',
  });
}

export function projectSecretsPrefix(projectId: string): string {
  const env = process.env.ENVIRONMENT ?? 'dev';
  return `walkcroach/${env}/projects/${projectId}/secrets`;
}

export function secretName(projectId: string, key: string): string {
  return `${projectSecretsPrefix(projectId)}/${key}`;
}

export function projectDbSecretName(projectId: string): string {
  const env = process.env.ENVIRONMENT ?? 'dev';
  return `walkcroach/${env}/projects/${projectId}/database`;
}

function localSecretPath(name: string): string {
  return join(LOCAL_ROOT, `${name.replace(/[/:]/g, '_')}.json`);
}

async function localRead(name: string): Promise<string | null> {
  try {
    return await readFile(localSecretPath(name), 'utf8');
  } catch {
    return null;
  }
}

async function localWrite(name: string, value: string): Promise<void> {
  const path = localSecretPath(name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, 'utf8');
}

export async function putProjectSecret(
  projectId: string,
  key: string,
  value: string,
): Promise<void> {
  const name = secretName(projectId, key);
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.FORCE_SM_SECRETS) {
    await localWrite(name, value);
    return;
  }
  const client = sm();
  try {
    await client.send(
      new PutSecretValueCommand({ SecretId: name, SecretString: value }),
    );
  } catch {
    await client.send(
      new CreateSecretCommand({
        Name: name,
        SecretString: value,
        Description: `WalkCroach project ${projectId} secret ${key}`,
      }),
    );
  }
}

export async function getProjectSecret(
  projectId: string,
  key: string,
): Promise<string | null> {
  const name = secretName(projectId, key);
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.FORCE_SM_SECRETS) {
    return localRead(name);
  }
  try {
    const res = await sm().send(
      new GetSecretValueCommand({ SecretId: name }),
    );
    return res.SecretString ?? null;
  } catch {
    return null;
  }
}

export async function listProjectSecretKeys(projectId: string): Promise<string[]> {
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.FORCE_SM_SECRETS) {
    try {
      const files = await readdir(LOCAL_ROOT);
      const prefix = projectSecretsPrefix(projectId).replace(/[/:]/g, '_');
      return files
        .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
        .map((f) => f.slice(prefix.length + 1, -5));
    } catch {
      return [];
    }
  }
  return [];
}

export type DbCredentials = {
  database: string;
  connectionString: string;
};

export async function putProjectDbCredentials(
  projectId: string,
  creds: DbCredentials,
): Promise<void> {
  const name = projectDbSecretName(projectId);
  const payload = JSON.stringify(creds);
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.FORCE_SM_SECRETS) {
    await localWrite(name, payload);
    return;
  }
  const client = sm();
  try {
    await client.send(
      new PutSecretValueCommand({ SecretId: name, SecretString: payload }),
    );
  } catch {
    await client.send(
      new CreateSecretCommand({
        Name: name,
        SecretString: payload,
        Description: `WalkCroach app database for project ${projectId}`,
      }),
    );
  }
}

export async function getProjectDbCredentials(
  projectId: string,
): Promise<DbCredentials | null> {
  const name = projectDbSecretName(projectId);
  let raw: string | null | undefined;
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.FORCE_SM_SECRETS) {
    raw = await localRead(name);
  } else {
    try {
      const res = await sm().send(
        new GetSecretValueCommand({ SecretId: name }),
      );
      raw = res.SecretString;
    } catch {
      raw = null;
    }
  }
  if (!raw) return null;
  return JSON.parse(raw) as DbCredentials;
}
