/**
 * Desktop IDE download — unsigned Windows preview only (see docs/walkcroach-desktop.md).
 * Set VITE_DESKTOP_DOWNLOAD_URL to a GitHub Release asset (or CDN) when published.
 * When unset, CTAs deep-link to the landing Desktop section instead of a fake download.
 */
export function getDesktopDownloadUrl(): string | null {
  const raw = import.meta.env.VITE_DESKTOP_DOWNLOAD_URL?.trim();
  return raw ? raw : null;
}

export const DESKTOP_DOWNLOAD_ANCHOR = '#surfaces-desktop';

export function desktopDownloadHref(): string {
  return getDesktopDownloadUrl() ?? DESKTOP_DOWNLOAD_ANCHOR;
}

export function desktopDownloadIsExternal(): boolean {
  return getDesktopDownloadUrl() !== null;
}
