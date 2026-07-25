/** Display helpers for project memory entries (incl. Chrome-mirrored captures). */

const CHROME_MARKER = /^\[chrome-capture:[^\]]+\]\s*/i;

export function displayMemoryText(text: string, sourceSurface: string): string {
  const raw = text?.trim() ?? '';
  if (!raw) return '';
  if (sourceSurface !== 'chrome') return raw;
  return raw.replace(CHROME_MARKER, '').trim() || raw;
}

export function memorySurfaceLabel(sourceSurface: string): string {
  switch (sourceSurface) {
    case 'chrome':
      return 'Chrome';
    case 'ide':
      return 'IDE';
    case 'web':
      return 'Web';
    case 'desktop':
      return 'Desktop';
    default:
      return sourceSurface || 'unknown';
  }
}
