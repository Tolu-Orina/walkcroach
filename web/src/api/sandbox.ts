import { preferredSandboxRuntime } from '../sandbox/types';

const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(
  /\/$/,
  '',
);

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  try {
    const raw = localStorage.getItem('walkcroach.auth.v1');
    if (raw) {
      const parsed = JSON.parse(raw) as {
        token?: string;
        cognito?: { idToken?: string };
      };
      const bearer = parsed.cognito?.idToken ?? parsed.token;
      if (bearer) headers.authorization = `Bearer ${bearer}`;
    }
  } catch {
    // ignore
  }
  return headers;
}

async function parseSandbox<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) {
    const err = data as { error?: string; code?: string };
    const message = err.error || `${res.status} ${res.statusText}`;
    throw Object.assign(new Error(message), {
      status: res.status,
      code: err.code,
    });
  }
  return data as T;
}

export type SandboxSessionInfo = {
  sandboxId: string | null;
  previewUrl: string | null;
  status: string;
  runtime: string;
};

export async function createProjectSandbox(
  projectId: string,
  templateId?: string | null,
): Promise<SandboxSessionInfo> {
  const res = await fetch(`${API_URL}/projects/${projectId}/sandbox`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ templateId: templateId ?? undefined }),
  });
  return parseSandbox(res);
}

export async function getProjectSandbox(
  projectId: string,
): Promise<SandboxSessionInfo> {
  const res = await fetch(`${API_URL}/projects/${projectId}/sandbox`, {
    headers: authHeaders(),
  });
  return parseSandbox(res);
}

export async function getSandboxPreview(
  projectId: string,
): Promise<{ url: string | null }> {
  const res = await fetch(`${API_URL}/projects/${projectId}/sandbox/preview`, {
    headers: authHeaders(),
  });
  return parseSandbox(res);
}

export async function deleteProjectSandbox(projectId: string): Promise<void> {
  const res = await fetch(`${API_URL}/projects/${projectId}/sandbox`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (res.status === 204 || res.ok) return;
  await parseSandbox(res);
}

export async function writeSandboxFile(
  projectId: string,
  path: string,
  content: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/projects/${projectId}/sandbox/write`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ path, content }),
  });
  await parseSandbox(res);
}

export async function editSandboxFile(
  projectId: string,
  path: string,
  oldStr: string,
  newStr: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/projects/${projectId}/sandbox/edit`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ path, old_str: oldStr, new_str: newStr }),
  });
  await parseSandbox(res);
}

export async function runSandboxTerminal(
  projectId: string,
  cmd: string,
): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string }> {
  const res = await fetch(`${API_URL}/projects/${projectId}/sandbox/terminal`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ cmd }),
  });
  return parseSandbox(res);
}

export async function listSandboxFiles(
  projectId: string,
): Promise<Array<{ path: string; content: string }>> {
  const res = await fetch(`${API_URL}/projects/${projectId}/sandbox/files`, {
    headers: authHeaders(),
  });
  const data = await parseSandbox<{ files: Array<{ path: string; content: string }> }>(
    res,
  );
  return data.files;
}

export async function readSandboxFile(
  projectId: string,
  path: string,
): Promise<{ path: string; content: string }> {
  const res = await fetch(`${API_URL}/projects/${projectId}/sandbox/read`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ path }),
  });
  return parseSandbox(res);
}

/** True when client prefers E2B (may still fall back). */
export function clientPrefersE2B(): boolean {
  return preferredSandboxRuntime() === 'e2b';
}
