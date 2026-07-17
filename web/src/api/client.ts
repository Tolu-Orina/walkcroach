import type { AgentEvent, AgentMode } from './types';

const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(
  /\/$/,
  '',
);

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function createProject(name: string): Promise<{ id: string }> {
  const res = await fetch(`${API_URL}/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, ownerId: 'web-anonymous' }),
  });
  return parseJson(res);
}

export async function createSession(
  projectId: string,
): Promise<{ id: string; projectId: string }> {
  const res = await fetch(`${API_URL}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId }),
  });
  return parseJson(res);
}

export type SessionDetail = {
  id: string;
  projectId: string;
  status: string;
  pendingTool: {
    toolCallId: string;
    tool: string;
    args: Record<string, unknown>;
  } | null;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
  }>;
};

export async function getSession(sessionId: string): Promise<SessionDetail> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}`);
  return parseJson(res);
}

export type ToolResultBody = {
  projectId: string;
  toolCallId: string;
  ok: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  output?: string;
};

async function* readNdjson(
  res: Response,
): AsyncGenerator<AgentEvent> {
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      yield JSON.parse(trimmed) as AgentEvent;
    }
  }

  const tail = buffer.trim();
  if (tail) yield JSON.parse(tail) as AgentEvent;
}

export async function* streamPrompt(
  sessionId: string,
  body: { message: string; projectId: string; mode: AgentMode },
): AsyncGenerator<AgentEvent> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}/prompt`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/x-ndjson',
    },
    body: JSON.stringify(body),
  });
  yield* readNdjson(res);
}

export async function* streamToolResult(
  sessionId: string,
  body: ToolResultBody,
): AsyncGenerator<AgentEvent> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}/tool-result`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/x-ndjson',
    },
    body: JSON.stringify(body),
  });
  yield* readNdjson(res);
}

export function getApiUrl(): string {
  return API_URL;
}
