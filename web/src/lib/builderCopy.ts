import type { ActivityEvent } from '../api/types';

/** Plain-language label for a build activity event (Metaphor A chips). */
export function activityChipLabel(event: ActivityEvent): string {
  const args = event.args ?? {};
  const path =
    typeof args.path === 'string'
      ? args.path.split('/').pop() ?? args.path
      : null;
  const cmd = typeof args.cmd === 'string' ? args.cmd : null;

  switch (event.tool) {
    case 'write_file':
      return path ? `Writing ${path}` : 'Writing a file';
    case 'edit_file':
      return path ? `Editing ${path}` : 'Editing a file';
    case 'run_terminal':
      if (cmd) {
        const short = cmd.length > 36 ? `${cmd.slice(0, 33)}…` : cmd;
        return `Running · ${short}`;
      }
      return 'Running a command';
    case 'web_search':
      return 'Searching the web';
    case 'read_file':
      return path ? `Reading ${path}` : 'Reading a file';
    case 'list_files':
      return 'Listing project files';
    default:
      if (event.summary) return event.summary;
      return event.tool.replace(/_/g, ' ');
  }
}

export function humanizeBuilderError(raw: string | null | undefined): string {
  if (!raw) return 'Something went wrong starting the preview.';
  const msg = raw.trim();
  if (/cross-origin isolated|COOP|COEP/i.test(msg)) {
    return 'Preview needs a secure browser setup. Refresh the page, or try another browser.';
  }
  if (/E2B_API_KEY|e2b/i.test(msg) && /required|missing|not configured/i.test(msg)) {
    return 'Cloud sandbox is not configured yet. Using local preview when available.';
  }
  if (/Failed to fetch|NetworkError|ECONNREFUSED/i.test(msg)) {
    return 'Cannot reach the WalkCroach API. Start the local backend or check your connection.';
  }
  if (/npm install|ENOENT|spawn/i.test(msg)) {
    return 'Could not install or start the app preview. Open Terminal for details.';
  }
  if (msg.length > 180) return `${msg.slice(0, 177)}…`;
  return msg;
}
