/**
 * In-app Google Drive browser for chat attach.
 *
 * Google Picker cannot be themed (it is a Google-hosted iframe). Listing via
 * Drive API lets WalkCroach render the chooser in our own dialog. That needs
 * `drive.readonly` — `drive.file` cannot list the user's library.
 */
import type { TokenSet } from './oauth.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_ID_RE = /^[a-zA-Z0-9_-]{8,128}$/;

export type DriveBrowserView = 'my_drive' | 'shared' | 'recent' | 'shared_drives';

export type DriveBrowserItem = {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  size?: number;
  modifiedTime?: string;
};

export type DriveSharedDrive = { id: string; name: string };

export type DriveBrowserPage = {
  items: DriveBrowserItem[];
  nextPageToken?: string;
  drives?: DriveSharedDrive[];
};

export type DriveBrowseInput = {
  tokens: TokenSet;
  view: DriveBrowserView;
  folderId?: string;
  driveId?: string;
  q?: string;
  pageToken?: string;
};

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function buildDriveListQuery(input: {
  view: DriveBrowserView;
  folderId?: string;
  driveId?: string;
  q?: string;
}): { path: string; params: URLSearchParams } | { error: string; code: 'bad_request' } {
  const search = input.q?.trim().slice(0, 200);
  const params = new URLSearchParams({
    pageSize: '50',
    fields:
      'nextPageToken,files(id,name,mimeType,size,modifiedTime,shortcutDetails)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  if (input.folderId && !DRIVE_ID_RE.test(input.folderId)) {
    return { error: 'Invalid folder.', code: 'bad_request' };
  }
  if (input.driveId && !DRIVE_ID_RE.test(input.driveId)) {
    return { error: 'Invalid shared drive.', code: 'bad_request' };
  }

  const clauses: string[] = ['trashed = false'];
  if (search) {
    clauses.push(`name contains '${escapeDriveQuery(search)}'`);
  }

  if (input.view === 'shared_drives' && !input.driveId && !input.folderId && !search) {
    return { path: '/drives', params: new URLSearchParams({ pageSize: '50' }) };
  }

  if (input.view === 'shared') {
    if (!search) clauses.push('sharedWithMe = true');
    params.set('corpora', 'allDrives');
  } else if (input.view === 'recent') {
    params.set('orderBy', 'modifiedTime desc');
    params.set('corpora', 'allDrives');
  } else if (input.driveId) {
    params.set('corpora', 'drive');
    params.set('driveId', input.driveId);
    const parent = input.folderId ?? input.driveId;
    if (!search) clauses.push(`'${parent}' in parents`);
  } else {
    params.set('corpora', 'user');
    const parent = input.folderId ?? 'root';
    if (!search && input.view === 'my_drive') {
      clauses.push(`'${parent}' in parents`);
    } else if (input.folderId && !search) {
      clauses.push(`'${input.folderId}' in parents`);
    }
  }

  params.set('q', clauses.join(' and '));
  return { path: '/files', params };
}

function mapFile(raw: {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  shortcutDetails?: { targetId?: string; targetMimeType?: string };
}): DriveBrowserItem | null {
  const id = raw.shortcutDetails?.targetId || raw.id;
  if (!id) return null;
  const mimeType = raw.shortcutDetails?.targetMimeType || raw.mimeType || '';
  return {
    id,
    name: raw.name || 'Untitled',
    mimeType,
    isFolder: mimeType === FOLDER_MIME,
    size: raw.size ? Number(raw.size) : undefined,
    modifiedTime: raw.modifiedTime,
  };
}

export async function listDriveBrowser(
  input: DriveBrowseInput,
): Promise<
  | DriveBrowserPage
  | { error: string; code: 'bad_request' | 'insufficient_scope' | 'fetch' }
> {
  const built = buildDriveListQuery(input);
  if ('error' in built) return built;

  if (input.pageToken) {
    built.params.set('pageToken', input.pageToken.slice(0, 1024));
  }

  const url = `https://www.googleapis.com/drive/v3${built.path}?${built.params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${input.tokens.accessToken}` },
  });

  if (res.status === 401 || res.status === 403) {
    return {
      error:
        'Google Drive needs to be reconnected so WalkCroach can list files in this window.',
      code: 'insufficient_scope',
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      error: `Could not list Drive files (${res.status})${body ? `: ${body.slice(0, 160)}` : ''}`,
      code: 'fetch',
    };
  }

  const json = (await res.json()) as {
    nextPageToken?: string;
    files?: Parameters<typeof mapFile>[0][];
    drives?: { id?: string; name?: string }[];
  };

  if (built.path === '/drives') {
    return {
      items: [],
      nextPageToken: json.nextPageToken,
      drives: (json.drives ?? [])
        .filter((d): d is { id: string; name: string } => Boolean(d.id && d.name))
        .map((d) => ({ id: d.id, name: d.name })),
    };
  }

  const items = (json.files ?? [])
    .map(mapFile)
    .filter((item): item is DriveBrowserItem => Boolean(item));

  return { items, nextPageToken: json.nextPageToken };
}
