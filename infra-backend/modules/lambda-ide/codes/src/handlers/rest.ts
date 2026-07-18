import type { AuthContext } from '../auth.js';
import { requireCognitoAuth } from '../auth.js';
import type { HttpRequest } from '../event.js';
import { CORS_HEADERS, jsonResponse } from '../http.js';
import {
  handleCreateLink,
  handleDeleteLink,
  handleListLinks,
} from './links.js';
import {
  handleListMemoryEntries,
  handleMemoryMirror,
  handleMemoryRecall,
  handleUpdateMemoryEntry,
} from './memory.js';
import { handleListMyProjects, handleMe } from './me.js';

/** Strip API Gateway stage prefix if present (`/v1/ide/...` → `/ide/...`). */
export function normalizeIdePath(path: string): string {
  let p = path || '/';
  if (p.startsWith('/v1/ide/')) p = p.slice(3);
  if (p.startsWith('/v1/ide')) p = `/ide${p.slice(7)}`;
  return p;
}

export async function handleIdeRest(req: HttpRequest) {
  const path = normalizeIdePath(req.path);
  const method = req.method.toUpperCase();

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  if (method === 'GET' && /\/ide\/v1\/health\/?$/.test(path)) {
    return jsonResponse(200, {
      ok: true,
      surface: 'ide',
      version: 'v1',
    });
  }

  const auth = await requireCognitoAuth(req.headers);
  if ('error' in auth) {
    return jsonResponse(auth.status, { error: auth.error });
  }

  if (method === 'GET' && /\/ide\/v1\/me\/projects\/?$/.test(path)) {
    return handleListMyProjects(auth);
  }

  if (method === 'GET' && /\/ide\/v1\/me\/?$/.test(path)) {
    return handleMe(auth, req.queryStringParameters);
  }

  if (method === 'GET' && /\/ide\/v1\/links\/?$/.test(path)) {
    return handleListLinks(auth);
  }

  if (method === 'POST' && /\/ide\/v1\/links\/?$/.test(path)) {
    return handleCreateLink(auth, req.body);
  }

  const delLink = path.match(/\/ide\/v1\/links\/([^/]+)\/?$/);
  if (method === 'DELETE' && delLink) {
    return handleDeleteLink(auth, delLink[1]!);
  }

  if (method === 'POST' && /\/ide\/v1\/memory\/mirror\/?$/.test(path)) {
    return handleMemoryMirror(auth, req.body);
  }

  if (method === 'POST' && /\/ide\/v1\/memory\/recall\/?$/.test(path)) {
    return handleMemoryRecall(auth, req.body);
  }

  if (method === 'GET' && /\/ide\/v1\/memory\/entries\/?$/.test(path)) {
    return handleListMemoryEntries(auth, req.queryStringParameters);
  }

  const patchMem = path.match(/\/ide\/v1\/memory\/entries\/([^/]+)\/?$/);
  if (method === 'PATCH' && patchMem) {
    return handleUpdateMemoryEntry(auth, patchMem[1]!, req.body);
  }

  return jsonResponse(404, { error: 'not found', path });
}

export type { AuthContext };
