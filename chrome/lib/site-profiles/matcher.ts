import profilesJson from './profiles.v1.json';

export type Sector =
  | 'recruiting'
  | 'sales'
  | 'retail'
  | 'real_estate'
  | 'support';

export type SiteProfile = {
  id: string;
  sector: Sector;
  label: string;
  actionId: string;
  captureType: string;
  defaultWorkspace: string;
  match: {
    hostSuffix: string[];
    pathIncludes: string[];
  };
  domHints?: string[];
  fields: string[];
  draftTone?: string;
};

export type SiteProfilesBundle = {
  version: number;
  profiles: SiteProfile[];
};

/** The bundle shipped inside the extension package — the always-available floor. */
export const SITE_PROFILES = profilesJson as SiteProfilesBundle;

/**
 * The bundle currently in force. Starts as the packaged one and may be swapped
 * for a newer signed bundle (see `remote.ts`).
 *
 * Mutable module state rather than a parameter because `matchSiteProfile` is
 * called from render paths and must stay synchronous — threading an async load
 * through every call site would turn a sector chip into a loading state.
 */
let activeBundle: SiteProfilesBundle = SITE_PROFILES;

/** Swap in a validated bundle. Callers must validate before calling. */
export function installProfiles(bundle: SiteProfilesBundle): void {
  activeBundle = bundle;
}

/** Restore the packaged profiles. Used by tests and as a safety valve. */
export function resetProfiles(): void {
  activeBundle = SITE_PROFILES;
}

export function activeProfiles(): SiteProfilesBundle {
  return activeBundle;
}

function hostMatches(hostname: string, suffix: string): boolean {
  const h = hostname.toLowerCase();
  const s = suffix.toLowerCase();
  return h === s || h.endsWith(`.${s}`);
}

/**
 * Client-side only (NFR-C13). First matching profile wins.
 * pathIncludes empty = host match alone is enough.
 */
export function matchSiteProfile(
  pageUrl: string,
  doc?: Document | null,
): SiteProfile | null {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }

  for (const profile of activeBundle.profiles) {
    const hostOk = profile.match.hostSuffix.some((s) =>
      hostMatches(url.hostname, s),
    );
    if (!hostOk) continue;

    const paths = profile.match.pathIncludes;
    const pathOk =
      paths.length === 0 ||
      paths.some((p) => url.pathname.toLowerCase().includes(p.toLowerCase()));
    if (!pathOk) continue;

    if (profile.domHints?.length && doc) {
      const hintOk = profile.domHints.some((sel) => {
        try {
          return Boolean(doc.querySelector(sel));
        } catch {
          return false;
        }
      });
      // DOM hints are soft: if none match, still accept URL match for support/retail
      if (!hintOk && profile.sector === 'support') {
        // support often needs compose UI; keep URL match
      }
    }

    return profile;
  }
  return null;
}

export function profilesVersion(): number {
  return activeBundle.version;
}
