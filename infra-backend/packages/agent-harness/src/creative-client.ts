/**
 * Client for WalkCroach lambda-creative.
 *
 * Prefers AWS Lambda Invoke when CREATIVE_LAMBDA_NAME is set.
 * Falls back to a local Python subprocess of the creative handler
 * (Phase B local/dev + CI) when unset — same contract either way.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { getBedrockRegion } from './bedrock.js';

export type CreativeRenderResult = {
  ok: boolean;
  assetId?: string;
  s3Key?: string;
  previewS3Key?: string | null;
  previewNote?: string | null;
  downloadName?: string;
  slideCount?: number;
  validation?: unknown;
  error?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  trace?: string;
};

export type SkillScriptResult = {
  ok: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  scriptPath?: string;
  error?: string;
  allowed?: string[];
};

function creativeLambdaName(): string {
  return (process.env.CREATIVE_LAMBDA_NAME ?? '').trim();
}

function localHandlerPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/ → packages/agent-harness/dist → … → modules/lambda-creative/codes/src/handler.py
  return resolve(
    here,
    '../../../modules/lambda-creative/codes/src/handler.py',
  );
}

async function invokeLocal(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const py = process.env.CREATIVE_PYTHON ?? process.env.PYTHON ?? 'python';
  const script = localHandlerPath();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(py, [script, JSON.stringify(payload)], {
      env: {
        ...process.env,
        WALKCROACH_WEB_SKILLS_DIR:
          process.env.WALKCROACH_WEB_SKILLS_DIR ??
          resolve(dirname(fileURLToPath(import.meta.url)), '../../../../skills/web'),
        PYTHONPATH: [
          dirname(script),
          process.env.PYTHONPATH ?? '',
        ]
          .filter(Boolean)
          .join(process.platform === 'win32' ? ';' : ':'),
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        resolvePromise(parsed);
      } catch {
        reject(
          new Error(
            `local creative handler failed (exit ${code}): ${stderr || stdout || 'no output'}`,
          ),
        );
      }
    });
  });
}

async function invokeLambda(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const name = creativeLambdaName();
  const client = new LambdaClient({ region: getBedrockRegion() });
  const res = await client.send(
    new InvokeCommand({
      FunctionName: name,
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  );
  if (res.FunctionError) {
    const raw = res.Payload ? Buffer.from(res.Payload).toString('utf8') : '';
    throw new Error(`creative lambda error: ${res.FunctionError} ${raw}`);
  }
  const raw = res.Payload ? Buffer.from(res.Payload).toString('utf8') : '{}';
  return JSON.parse(raw) as Record<string, unknown>;
}

async function invokeCreative(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (creativeLambdaName()) return invokeLambda(payload);
  return invokeLocal(payload);
}

export async function invokeRenderPptx(params: {
  brief: Record<string, unknown>;
  ownerId: string;
  assetId: string;
  imageRefs?: Record<string, string>;
}): Promise<CreativeRenderResult> {
  const raw = await invokeCreative({
    action: 'render_pptx',
    brief: params.brief,
    ownerId: params.ownerId,
    assetId: params.assetId,
    imageRefs: params.imageRefs ?? {},
  });
  return raw as CreativeRenderResult;
}

export async function invokeRunSkillScript(params: {
  script: string;
  args: string[];
  timeoutS?: number;
}): Promise<SkillScriptResult> {
  const raw = await invokeCreative({
    action: 'run_skill_script',
    script: params.script,
    args: params.args,
    timeoutS: params.timeoutS,
  });
  return raw as SkillScriptResult;
}
