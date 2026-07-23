/**
 * Disk-backed agent sessions under `.walkcroach/sessions/` (Claude jsonl resume pattern).
 *
 * Layout:
 *   .walkcroach/sessions/active.json          → { sessionId, updatedAt }
 *   .walkcroach/sessions/<id>/messages.jsonl  → one Bedrock Message per line
 *   .walkcroach/sessions/<id>/ui.json         → { transcript, createdAt, updatedAt }
 */

import { mkdir, readFile, writeFile, unlink, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Message } from '@aws-sdk/client-bedrock-runtime';
import { WALK_CROACH_DIR } from './session-fs.js';
import { cloneMessages, trimSessionMessages } from './session.js';

export const SESSIONS_REL_DIR = `${WALK_CROACH_DIR}/sessions`;
export const ACTIVE_SESSION_REL = `${SESSIONS_REL_DIR}/active.json`;

export type AgentSessionSnapshot = {
  sessionId: string;
  messages: Message[];
  transcript: string;
  createdAt: string;
  updatedAt: string;
};

export type ActiveSessionPointer = {
  sessionId: string;
  updatedAt: string;
};

function sessionsRoot(workspaceRoot: string): string {
  return join(workspaceRoot, SESSIONS_REL_DIR);
}

function sessionDir(workspaceRoot: string, sessionId: string): string {
  return join(sessionsRoot(workspaceRoot), sessionId);
}

export function newSessionId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

export async function readActiveSessionPointer(
  workspaceRoot: string,
): Promise<ActiveSessionPointer | null> {
  try {
    const raw = await readFile(join(workspaceRoot, ACTIVE_SESSION_REL), 'utf8');
    const parsed = JSON.parse(raw) as { sessionId?: string; updatedAt?: string };
    if (!parsed.sessionId?.trim()) return null;
    return {
      sessionId: parsed.sessionId.trim(),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function loadAgentSession(
  workspaceRoot: string,
  sessionId?: string,
): Promise<AgentSessionSnapshot | null> {
  const id =
    sessionId ?? (await readActiveSessionPointer(workspaceRoot))?.sessionId;
  if (!id) return null;

  const dir = sessionDir(workspaceRoot, id);
  try {
    const jsonl = await readFile(join(dir, 'messages.jsonl'), 'utf8');
    const messages: Message[] = [];
    for (const line of jsonl.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as Message;
        if (msg && (msg.role === 'user' || msg.role === 'assistant')) {
          messages.push(msg);
        }
      } catch {
        /* skip corrupt line */
      }
    }
    if (!messages.length) return null;

    let transcript = '';
    let createdAt = new Date().toISOString();
    let updatedAt = createdAt;
    try {
      const ui = JSON.parse(await readFile(join(dir, 'ui.json'), 'utf8')) as {
        transcript?: string;
        createdAt?: string;
        updatedAt?: string;
      };
      transcript = typeof ui.transcript === 'string' ? ui.transcript : '';
      if (ui.createdAt) createdAt = ui.createdAt;
      if (ui.updatedAt) updatedAt = ui.updatedAt;
    } catch {
      /* ui optional */
    }

    return {
      sessionId: id,
      messages: trimSessionMessages(cloneMessages(messages)),
      transcript,
      createdAt,
      updatedAt,
    };
  } catch {
    return null;
  }
}

export async function persistAgentSession(
  workspaceRoot: string,
  snapshot: {
    sessionId: string;
    messages: Message[];
    transcript?: string;
    createdAt?: string;
  },
  opts?: { maxSessions?: number },
): Promise<AgentSessionSnapshot> {
  const now = new Date().toISOString();
  const id = snapshot.sessionId.trim() || newSessionId();
  const dir = sessionDir(workspaceRoot, id);
  await mkdir(dir, { recursive: true });

  let createdAt = snapshot.createdAt ?? now;
  try {
    const prev = JSON.parse(await readFile(join(dir, 'ui.json'), 'utf8')) as {
      createdAt?: string;
    };
    if (prev.createdAt) createdAt = prev.createdAt;
  } catch {
    /* new session */
  }

  const messages = trimSessionMessages(cloneMessages(snapshot.messages));
  const body =
    messages.map((m) => JSON.stringify(m)).join('\n') +
    (messages.length ? '\n' : '');
  await writeFile(join(dir, 'messages.jsonl'), body, 'utf8');

  const ui = {
    transcript: snapshot.transcript ?? '',
    createdAt,
    updatedAt: now,
    messageCount: messages.length,
  };
  await writeFile(join(dir, 'ui.json'), `${JSON.stringify(ui, null, 2)}\n`, 'utf8');

  const active: ActiveSessionPointer = { sessionId: id, updatedAt: now };
  await mkdir(sessionsRoot(workspaceRoot), { recursive: true });
  await writeFile(
    join(workspaceRoot, ACTIVE_SESSION_REL),
    `${JSON.stringify(active, null, 2)}\n`,
    'utf8',
  );

  await pruneOldSessions(workspaceRoot, opts?.maxSessions ?? 20, id);

  return {
    sessionId: id,
    messages,
    transcript: ui.transcript,
    createdAt,
    updatedAt: now,
  };
}

export async function clearActiveAgentSession(
  workspaceRoot: string,
  opts?: { deleteFiles?: boolean },
): Promise<void> {
  const active = await readActiveSessionPointer(workspaceRoot);
  try {
    await unlink(join(workspaceRoot, ACTIVE_SESSION_REL));
  } catch {
    /* missing */
  }
  if (opts?.deleteFiles !== false && active?.sessionId) {
    try {
      await rm(sessionDir(workspaceRoot, active.sessionId), {
        recursive: true,
        force: true,
      });
    } catch {
      /* ignore */
    }
  }
}

async function pruneOldSessions(
  workspaceRoot: string,
  maxSessions: number,
  keepId: string,
): Promise<void> {
  if (maxSessions <= 0) return;
  const root = sessionsRoot(workspaceRoot);
  let entries: string[] = [];
  try {
    entries = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return;
  }
  if (entries.length <= maxSessions) return;

  const scored: Array<{ id: string; updatedAt: number }> = [];
  for (const id of entries) {
    let updatedAt = 0;
    try {
      const ui = JSON.parse(
        await readFile(join(root, id, 'ui.json'), 'utf8'),
      ) as { updatedAt?: string };
      updatedAt = ui.updatedAt ? Date.parse(ui.updatedAt) : 0;
    } catch {
      updatedAt = 0;
    }
    scored.push({ id, updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0 });
  }
  scored.sort((a, b) => b.updatedAt - a.updatedAt);
  for (const row of scored.slice(maxSessions)) {
    if (row.id === keepId) continue;
    try {
      await rm(join(root, row.id), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
