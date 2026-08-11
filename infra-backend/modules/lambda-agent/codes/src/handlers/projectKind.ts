/**
 * Project kind contract for WalkCroach Web (ADR-0004).
 *
 * Pillars → schema:
 *   Chat        → general   (only via /me/chat-workspace)
 *   Project     → knowledge
 *   App Builder → app
 *
 * Pure helpers — unit-test without DB.
 */

export type ProjectKind = 'app' | 'general' | 'knowledge';

/** Creatable via POST /projects (not Chat). */
export type CreatableProjectKind = 'app' | 'knowledge';

export type KindResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Resolve kind for POST /projects.
 * Omitted → app (backward compatible with /try, Welcome, App Builder).
 * general is rejected — use POST /me/chat-workspace.
 */
export function resolveCreateProjectKind(
  raw: unknown,
): KindResult<CreatableProjectKind> {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: 'app' };
  }
  if (raw === 'app' || raw === 'knowledge') {
    return { ok: true, value: raw };
  }
  if (raw === 'general') {
    return {
      ok: false,
      error: 'kind=general is reserved for Chat — use POST /me/chat-workspace',
    };
  }
  return {
    ok: false,
    error: "kind must be 'app' or 'knowledge'",
  };
}

/**
 * template_id rules:
 *   knowledge → always NULL (ignore caller templateId)
 *   app       → trim string or default 'blank'
 */
export function resolveCreateTemplateId(
  kind: CreatableProjectKind,
  templateId: unknown,
): string | null {
  if (kind === 'knowledge') {
    return null;
  }
  if (typeof templateId === 'string' && templateId.trim()) {
    return templateId.trim().slice(0, 80);
  }
  return 'blank';
}

/**
 * GET /projects?kind=
 *   omitted / empty → null (all non-general)
 *   app | knowledge → filter
 */
export function parseListProjectsKindFilter(
  raw: string | null | undefined,
): KindResult<CreatableProjectKind | null> {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: null };
  }
  if (raw === 'app' || raw === 'knowledge') {
    return { ok: true, value: raw };
  }
  return {
    ok: false,
    error: "kind query must be 'app' or 'knowledge'",
  };
}

/** PATCH: knowledge rows must not gain a template_id. */
export function resolvePatchTemplateId(params: {
  kind: string | null | undefined;
  bodyTemplateId: unknown;
  currentTemplateId: string | null;
}): string | null {
  const kind = params.kind ?? 'app';
  if (kind === 'knowledge') {
    return null;
  }
  if (
    typeof params.bodyTemplateId === 'string' &&
    params.bodyTemplateId.trim()
  ) {
    return params.bodyTemplateId.trim().slice(0, 80);
  }
  if (params.bodyTemplateId === null) {
    return params.currentTemplateId;
  }
  // undefined → keep current; empty string → keep current
  return params.currentTemplateId;
}
