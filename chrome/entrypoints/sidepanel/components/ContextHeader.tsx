import { originLabel } from '../../../lib/permissions';
import { type PageAccess } from '../../../lib/page-access';
import type { SiteProfile } from '../../../lib/site-profiles/matcher';

/**
 * "What page am I on, and does WalkCroach know about it?" — answered before any
 * action is offered, and without uploading anything.
 *
 * The character count is deliberate: it is the honest signal that page text has
 * been read into the panel. Absent it, users cannot tell read from unread.
 */
export function ContextHeader({
  access,
  profile,
  extractChars,
}: {
  access: PageAccess | null;
  profile: SiteProfile | null;
  extractChars: number | null;
}) {
  const title = pageTitle(access);
  const host =
    access?.status === 'ready' || access?.status === 'needs-grant'
      ? originLabel(access.origin)
      : null;

  return (
    <div className="wc-context">
      <p className="wc-eyebrow">This page</p>
      <h2 className="wc-context__title">{title}</h2>
      <div className="wc-context__meta">
        {host && <span className="wc-context__host">{host}</span>}
        {profile && (
          <span className="wc-sector">
            {profile.sector.replace(/_/g, ' ')}
          </span>
        )}
        {extractChars !== null && (
          <span className="wc-mono wc-small">
            {extractChars.toLocaleString()} chars read
          </span>
        )}
      </div>
    </div>
  );
}

function pageTitle(access: PageAccess | null): string {
  if (!access) return 'Checking this tab…';
  switch (access.status) {
    case 'ready':
    case 'needs-grant':
      return access.title || originLabel(access.origin);
    case 'restricted':
      return 'This page can’t be read';
    case 'unknown':
      return 'Tab not visible yet';
    case 'no-tab':
      return 'No page focused';
  }
}
