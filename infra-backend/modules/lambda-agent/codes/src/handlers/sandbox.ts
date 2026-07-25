/**
 * Project-scoped E2B sandbox REST handlers (P0).
 * Durable identity in projects.e2b_sandbox_id; warm process cache optional.
 */
import { createDbClient } from '@walkcroach/db';
import {
  buildTemplateFiles,
  createSandboxRuntime,
  E2BSandboxRuntime,
  type SandboxRuntime,
} from '@walkcroach/agent-harness';
import { requireAuth } from '../auth.js';
import { jsonResponse } from '../http.js';
import type { RestResult } from './rest.js';

type SandboxEntry = {
  runtime: SandboxRuntime;
  previewUrl: string | null;
  lastUsedAt: number;
  bootPromise: Promise<void> | null;
  sandboxId: string | null;
  /** Last scaffold template mounted into this sandbox. */
  templateId: string | null;
};

type ProjectSandboxRow = {
  id: string;
  name: string;
  template_id: string | null;
  e2b_sandbox_id: string | null;
  e2b_preview_url: string | null;
};

/** Warm cache only — DB is source of truth for identity. */
const warm = new Map<string, SandboxEntry>();
/** In-flight createFresh — concurrent POSTs share one boot. */
const creating = new Map<string, Promise<SandboxEntry>>();
const IDLE_MS = 30 * 60 * 1000;

function pruneIdle(): void {
  const now = Date.now();
  for (const [projectId, entry] of warm) {
    if (now - entry.lastUsedAt < IDLE_MS) continue;
    warm.delete(projectId);
    // Do not kill — durable sandbox stays in E2B; reconnect later.
  }
}

async function assertOwner(
  projectId: string,
  headers: Record<string, string | undefined>,
): Promise<
  | { ok: true; ownerId: string }
  | { ok: false; result: RestResult }
> {
  const authResult = await requireAuth(headers);
  if ('error' in authResult) {
    return {
      ok: false,
      result: jsonResponse(authResult.status, { error: authResult.error }),
    };
  }
  const db = createDbClient();
  try {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM projects
       WHERE id = $1::uuid AND owner_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [projectId, authResult.ownerId],
    );
    if (!rows[0]) {
      return {
        ok: false,
        result: jsonResponse(404, { error: 'project not found' }),
      };
    }
    return { ok: true, ownerId: authResult.ownerId };
  } finally {
    await db.close();
  }
}

function e2bConfigured(): boolean {
  return Boolean(process.env.E2B_API_KEY || process.env.e2b_api_key);
}

async function loadProject(projectId: string): Promise<ProjectSandboxRow | null> {
  const db = createDbClient();
  try {
    const { rows } = await db.query<ProjectSandboxRow>(
      `SELECT id, name, template_id, e2b_sandbox_id, e2b_preview_url
       FROM projects
       WHERE id = $1::uuid AND deleted_at IS NULL
       LIMIT 1`,
      [projectId],
    );
    return rows[0] ?? null;
  } finally {
    await db.close();
  }
}

async function persistSandbox(
  projectId: string,
  sandboxId: string | null,
  previewUrl: string | null,
): Promise<void> {
  const db = createDbClient();
  try {
    await db.query(
      `UPDATE projects
       SET e2b_sandbox_id = $2,
           e2b_preview_url = $3,
           e2b_sandbox_at = now(),
           updated_at = now()
       WHERE id = $1::uuid`,
      [projectId, sandboxId, previewUrl],
    );
  } finally {
    await db.close();
  }
}

async function clearSandbox(projectId: string): Promise<void> {
  await persistSandbox(projectId, null, null);
}

function toResponse(entry: SandboxEntry) {
  const info = entry.runtime.getInfo();
  return {
    sandboxId: entry.sandboxId ?? info.sandboxId,
    previewUrl: entry.previewUrl ?? info.previewUrl,
    status: 'ready' as const,
    runtime: 'e2b' as const,
  };
}

async function tryReconnect(
  projectId: string,
  sandboxId: string,
  storedPreview: string | null,
): Promise<SandboxEntry | null> {
  try {
    const runtime = await createSandboxRuntime({
      prefer: 'e2b',
      sandboxId,
    });
    let previewUrl = storedPreview ?? runtime.getInfo().previewUrl;
    try {
      if (runtime instanceof E2BSandboxRuntime) {
        // Host URL alone is not enough — Vite may have died after idle.
        previewUrl = await runtime.ensurePreview();
      }
    } catch {
      /* keep stored / getInfo URL */
    }
    const entry: SandboxEntry = {
      runtime,
      previewUrl,
      lastUsedAt: Date.now(),
      bootPromise: null,
      sandboxId: runtime.getInfo().sandboxId ?? sandboxId,
      templateId: null,
    };
    warm.set(projectId, entry);
    if (previewUrl && previewUrl !== storedPreview) {
      await persistSandbox(projectId, entry.sandboxId, previewUrl);
    }
    return entry;
  } catch {
    return null;
  }
}

async function createFresh(
  projectId: string,
  projectName: string,
  templateId: string | null,
): Promise<SandboxEntry> {
  if (!e2bConfigured()) {
    throw Object.assign(new Error('E2B_API_KEY is not configured'), {
      status: 503,
      code: 'e2b_unavailable',
    });
  }

  const runtime = await createSandboxRuntime({ prefer: 'e2b' });
  if (!(runtime instanceof E2BSandboxRuntime)) {
    throw new Error('expected E2B runtime');
  }

  const files = buildTemplateFiles(templateId, projectName);
  await runtime.mountFiles(files);
  const previewUrl = await runtime.installAndStartPreview();
  const sandboxId = runtime.getInfo().sandboxId;
  if (!sandboxId) {
    throw new Error('E2B sandbox created without sandboxId');
  }
  await persistSandbox(projectId, sandboxId, previewUrl);

  const entry: SandboxEntry = {
    runtime,
    previewUrl,
    lastUsedAt: Date.now(),
    bootPromise: null,
    sandboxId,
    templateId,
  };
  warm.set(projectId, entry);
  return entry;
}

/**
 * Remount starter files into an existing sandbox and restart Vite.
 * Used when the user picks a different template without killing E2B identity.
 */
async function remountTemplate(
  entry: SandboxEntry,
  projectId: string,
  projectName: string,
  templateId: string,
): Promise<SandboxEntry> {
  if (!(entry.runtime instanceof E2BSandboxRuntime)) {
    throw new Error('remount requires E2B runtime');
  }
  const files = buildTemplateFiles(templateId, projectName);
  await entry.runtime.mountFiles(files);
  const install = await entry.runtime.runTerminal('npm install');
  if (!install.ok) {
    throw new Error(
      `npm install failed after template remount: ${install.stderr || install.stdout || 'unknown'}`,
    );
  }
  const previewUrl = await entry.runtime.startPreview();
  entry.previewUrl = previewUrl;
  entry.templateId = templateId;
  entry.lastUsedAt = Date.now();
  await persistSandbox(projectId, entry.sandboxId, previewUrl);
  return entry;
}

async function disposeCached(projectId: string): Promise<void> {
  const cached = warm.get(projectId);
  if (cached) {
    warm.delete(projectId);
    await cached.runtime.dispose().catch(() => undefined);
  } else {
    const project = await loadProject(projectId);
    if (project?.e2b_sandbox_id) {
      try {
        const runtime = await createSandboxRuntime({
          prefer: 'e2b',
          sandboxId: project.e2b_sandbox_id,
        });
        await runtime.dispose();
      } catch {
        /* already gone */
      }
    }
  }
  await clearSandbox(projectId);
}

async function getOrCreate(
  projectId: string,
  bodyTemplateId?: string | null,
  opts?: { forceRemount?: boolean; reset?: boolean },
): Promise<SandboxEntry> {
  pruneIdle();

  const project = await loadProject(projectId);
  if (!project) {
    throw Object.assign(new Error('project not found'), { status: 404 });
  }

  const templateId =
    bodyTemplateId?.trim() || project.template_id || 'blank';

  if (opts?.reset) {
    await disposeCached(projectId);
    return createFresh(projectId, project.name, templateId);
  }

  const cached = warm.get(projectId);
  if (cached) {
    cached.lastUsedAt = Date.now();
    if (cached.bootPromise) await cached.bootPromise;
    const needsRemount =
      opts?.forceRemount ||
      (Boolean(bodyTemplateId?.trim()) &&
        cached.templateId !== null &&
        cached.templateId !== templateId) ||
      (Boolean(bodyTemplateId?.trim()) && cached.templateId === null);
    if (needsRemount) {
      return remountTemplate(cached, projectId, project.name, templateId);
    }
    // Ensure preview is alive even on cache hit
    if (cached.runtime instanceof E2BSandboxRuntime) {
      try {
        const url = await cached.runtime.ensurePreview();
        cached.previewUrl = url;
        await persistSandbox(projectId, cached.sandboxId, url);
      } catch {
        /* keep prior URL */
      }
    }
    return cached;
  }

  if (project.e2b_sandbox_id) {
    const reconnected = await tryReconnect(
      projectId,
      project.e2b_sandbox_id,
      project.e2b_preview_url,
    );
    if (reconnected) {
      reconnected.templateId = project.template_id;
      const needsRemount =
        opts?.forceRemount ||
        (Boolean(bodyTemplateId?.trim()) &&
          (reconnected.templateId ?? 'blank') !== templateId);
      if (needsRemount) {
        return remountTemplate(
          reconnected,
          projectId,
          project.name,
          templateId,
        );
      }
      return reconnected;
    }
    // Stale id — clear and recreate
    await clearSandbox(projectId);
  }

  const inflight = creating.get(projectId);
  if (inflight) return inflight;

  const boot = createFresh(projectId, project.name, templateId).finally(() => {
    creating.delete(projectId);
  });
  creating.set(projectId, boot);
  return boot;
}

async function requireEntry(projectId: string): Promise<SandboxEntry> {
  pruneIdle();
  const cached = warm.get(projectId);
  if (cached) {
    cached.lastUsedAt = Date.now();
    return cached;
  }

  const project = await loadProject(projectId);
  if (project?.e2b_sandbox_id) {
    const reconnected = await tryReconnect(
      projectId,
      project.e2b_sandbox_id,
      project.e2b_preview_url,
    );
    if (reconnected) return reconnected;
  }

  throw Object.assign(new Error('sandbox not started — POST /sandbox first'), {
    status: 404,
    code: 'sandbox_missing',
  });
}

function errResponse(err: unknown): RestResult {
  const status =
    err && typeof err === 'object' && 'status' in err
      ? Number((err as { status: number }).status) || 500
      : 500;
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: string }).code)
      : undefined;
  return jsonResponse(status, { error: message, code });
}

export async function handleSandboxRoutes(
  method: string,
  path: string,
  rawBody: string | undefined,
  headers: Record<string, string | undefined>,
): Promise<RestResult | null> {
  const match = path.match(/\/projects\/([^/]+)\/sandbox(?:\/([^/?]+))?\/?$/);
  if (!match) return null;

  const projectId = match[1]!;
  const action = match[2] ?? '';

  const auth = await assertOwner(projectId, headers);
  if (!auth.ok) return auth.result;

  let body: Record<string, unknown> = {};
  if (rawBody) {
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return jsonResponse(400, { error: 'invalid json body' });
    }
  }

  try {
    if (method === 'POST' && action === '') {
      const templateId =
        typeof body.templateId === 'string' ? body.templateId : null;
      const forceRemount = body.forceRemount === true;
      const reset = body.reset === true;
      const entry = await getOrCreate(projectId, templateId, {
        forceRemount,
        reset,
      });
      return jsonResponse(200, toResponse(entry));
    }

    if (method === 'GET' && action === '') {
      try {
        const entry = await requireEntry(projectId);
        return jsonResponse(200, toResponse(entry));
      } catch (err) {
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: string }).code === 'sandbox_missing'
        ) {
          return jsonResponse(404, {
            error: 'sandbox not started',
            code: 'sandbox_missing',
            e2bConfigured: e2bConfigured(),
          });
        }
        throw err;
      }
    }

    if (method === 'DELETE' && action === '') {
      await disposeCached(projectId);
      return jsonResponse(204, {});
    }

    if (method === 'POST' && action === 'write') {
      const pathArg = typeof body.path === 'string' ? body.path : '';
      const content = typeof body.content === 'string' ? body.content : '';
      if (!pathArg) return jsonResponse(400, { error: 'path required' });
      const entry = await requireEntry(projectId);
      await entry.runtime.writeFile(pathArg, content);
      return jsonResponse(204, {});
    }

    if (method === 'POST' && action === 'edit') {
      const pathArg = typeof body.path === 'string' ? body.path : '';
      const oldStr = typeof body.old_str === 'string' ? body.old_str : '';
      const newStr = typeof body.new_str === 'string' ? body.new_str : '';
      if (!pathArg) return jsonResponse(400, { error: 'path required' });
      const entry = await requireEntry(projectId);
      await entry.runtime.editFile(pathArg, oldStr, newStr);
      return jsonResponse(204, {});
    }

    if (method === 'POST' && action === 'terminal') {
      const cmd = typeof body.cmd === 'string' ? body.cmd : '';
      if (!cmd) return jsonResponse(400, { error: 'cmd required' });
      const entry = await requireEntry(projectId);
      const result = await entry.runtime.runTerminal(cmd);
      return jsonResponse(200, result);
    }

    if (method === 'GET' && action === 'files') {
      const entry = await requireEntry(projectId);
      const paths = await entry.runtime.listFiles();
      const files: Array<{ path: string; content: string }> = [];
      for (const p of paths.slice(0, 200)) {
        try {
          const content = await entry.runtime.readFile(p);
          files.push({ path: p, content });
        } catch {
          // skip unreadable
        }
      }
      return jsonResponse(200, { files });
    }

    if (method === 'POST' && action === 'read') {
      const pathArg = typeof body.path === 'string' ? body.path : '';
      if (!pathArg) return jsonResponse(400, { error: 'path required' });
      const entry = await requireEntry(projectId);
      const content = await entry.runtime.readFile(pathArg);
      return jsonResponse(200, { path: pathArg, content });
    }

    if (method === 'GET' && action === 'preview') {
      const entry = await requireEntry(projectId);
      if (entry.runtime instanceof E2BSandboxRuntime) {
        try {
          const url = await entry.runtime.ensurePreview();
          entry.previewUrl = url;
          entry.lastUsedAt = Date.now();
          await persistSandbox(projectId, entry.sandboxId, url);
          return jsonResponse(200, { url });
        } catch (err) {
          return errResponse(err);
        }
      }
      return jsonResponse(200, {
        url: entry.previewUrl ?? entry.runtime.getInfo().previewUrl,
      });
    }

    return jsonResponse(404, { error: 'sandbox route not found' });
  } catch (err) {
    return errResponse(err);
  }
}

/** Read file with query param — called when path includes ?path= */
export async function handleSandboxFileGet(
  projectId: string,
  filePath: string,
  headers: Record<string, string | undefined>,
): Promise<RestResult> {
  const auth = await assertOwner(projectId, headers);
  if (!auth.ok) return auth.result;
  try {
    const entry = await requireEntry(projectId);
    const content = await entry.runtime.readFile(filePath);
    return jsonResponse(200, { path: filePath, content });
  } catch (err) {
    return errResponse(err);
  }
}
