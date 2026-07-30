import type { SiteProfile, SiteProfilesBundle } from './matcher';

/**
 * Strict validation for a site-profiles bundle (Phase D6).
 *
 * Profiles can now arrive from the network, so they are untrusted input even
 * after the signature checks out — a signature proves origin, not correctness.
 * Anything malformed is rejected wholesale rather than partially applied: a
 * half-valid bundle would silently disable sector actions on some sites and be
 * very hard to diagnose from a user report.
 *
 * This is data only. Nothing here is executed, which is what keeps remote
 * profiles outside the Chrome Web Store's remote-code policy.
 */

const SECTORS = new Set([
  'recruiting',
  'sales',
  'retail',
  'real_estate',
  'support',
]);

/** Guards against a hostile or buggy bundle exhausting the match loop. */
export const MAX_PROFILES = 200;
export const MAX_PATTERNS_PER_PROFILE = 50;

function isStringArray(v: unknown, max: number): v is string[] {
  return (
    Array.isArray(v) &&
    v.length <= max &&
    v.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 200)
  );
}

function str(v: unknown, max = 120): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

export function validateProfile(input: unknown): SiteProfile | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const p = input as Record<string, unknown>;

  if (!str(p.id) || !str(p.label) || !str(p.actionId)) return null;
  if (!str(p.captureType) || !str(p.defaultWorkspace)) return null;
  if (typeof p.sector !== 'string' || !SECTORS.has(p.sector)) return null;

  const match = p.match;
  if (!match || typeof match !== 'object' || Array.isArray(match)) return null;
  const m = match as Record<string, unknown>;
  if (!isStringArray(m.hostSuffix, MAX_PATTERNS_PER_PROFILE)) return null;
  if (!Array.isArray(m.pathIncludes)) return null;
  if (
    m.pathIncludes.length > 0 &&
    !isStringArray(m.pathIncludes, MAX_PATTERNS_PER_PROFILE)
  ) {
    return null;
  }
  // A host suffix must be a bare host, never a pattern or a URL — otherwise a
  // bundle could widen matching far beyond what the label implies.
  if (
    (m.hostSuffix as string[]).some(
      (h) => h.includes('/') || h.includes('*') || h.includes(':'),
    )
  ) {
    return null;
  }

  if (!Array.isArray(p.fields)) return null;
  if (p.fields.length > 0 && !isStringArray(p.fields, 24)) return null;
  if (p.domHints !== undefined && !isStringArray(p.domHints, 24)) return null;
  if (p.draftTone !== undefined && !str(p.draftTone, 200)) return null;

  return {
    id: p.id,
    sector: p.sector as SiteProfile['sector'],
    label: p.label,
    actionId: p.actionId,
    captureType: p.captureType,
    defaultWorkspace: p.defaultWorkspace,
    match: {
      hostSuffix: m.hostSuffix as string[],
      pathIncludes: m.pathIncludes as string[],
    },
    ...(p.domHints ? { domHints: p.domHints as string[] } : {}),
    fields: p.fields as string[],
    ...(p.draftTone ? { draftTone: p.draftTone } : {}),
  };
}

export function validateProfilesBundle(
  input: unknown,
): SiteProfilesBundle | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const b = input as Record<string, unknown>;
  if (typeof b.version !== 'number' || !Number.isInteger(b.version)) return null;
  if (b.version < 1) return null;
  if (!Array.isArray(b.profiles) || b.profiles.length === 0) return null;
  if (b.profiles.length > MAX_PROFILES) return null;

  const profiles: SiteProfile[] = [];
  const seen = new Set<string>();
  for (const raw of b.profiles) {
    const profile = validateProfile(raw);
    // All-or-nothing: one bad entry rejects the bundle.
    if (!profile) return null;
    if (seen.has(profile.id)) return null;
    seen.add(profile.id);
    profiles.push(profile);
  }
  return { version: b.version, profiles };
}
