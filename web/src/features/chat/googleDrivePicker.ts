/**
 * Google Drive attach via Google Picker.
 *
 * Google Picker cannot run under any COEP (including credentialless). The SPA
 * keeps COEP for WebContainer; the picker runs on /drive-picker.html (no COEP).
 *
 * Do not use window.closed / window.opener: COOP: same-origin reports popups as
 * closed and nulls opener, which was closing the picker in ~400ms (blink).
 * Handshake is localStorage, which is shared across same-origin windows.
 */

export const DRIVE_PICKER_CFG_PREFIX = 'wc-drive-picker:cfg:';
export const DRIVE_PICKER_OUT_PREFIX = 'wc-drive-picker:out:';

/** Derive Cloud project number from an OAuth web client id when possible. */
export function projectNumberFromClientId(clientId: string): string | null {
  const prefix = clientId.trim().split('-')[0] ?? '';
  return /^\d{6,}$/.test(prefix) ? prefix : null;
}

export type DrivePickerConfig = {
  accessToken: string;
  apiKey: string;
  appId: string;
  maxItems: number;
};

export type DrivePickerResult =
  | { type: 'picked'; fileIds: string[] }
  | { type: 'cancel' }
  | { type: 'error'; message: string };

function isDrivePickerResult(value: unknown): value is DrivePickerResult {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: string }).type;
  return type === 'picked' || type === 'cancel' || type === 'error';
}

export function drivePickerCfgKey(id: string): string {
  return `${DRIVE_PICKER_CFG_PREFIX}${id}`;
}

export function drivePickerOutKey(id: string): string {
  return `${DRIVE_PICKER_OUT_PREFIX}${id}`;
}

export function readDrivePickerResult(raw: string | null): DrivePickerResult | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isDrivePickerResult(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function openGoogleDrivePicker(input: {
  accessToken: string;
  apiKey: string;
  /** Cloud project number — required for drive.file. */
  appId: string;
  clientId?: string;
  maxItems?: number;
}): Promise<string[]> {
  const appId = input.appId.trim();
  if (!/^\d{6,}$/.test(appId)) {
    throw new Error(
      'Google Drive picker is misconfigured (missing Cloud project number / appId). Add google_cloud_project_number to the runtime secret.',
    );
  }
  if (!input.apiKey.trim()) {
    throw new Error('Google Drive picker is misconfigured (missing API key).');
  }
  if (!input.accessToken.trim()) {
    throw new Error('Google Drive session expired. Reconnect and try again.');
  }

  const id = crypto.randomUUID();
  const cfgKey = drivePickerCfgKey(id);
  const outKey = drivePickerOutKey(id);
  const maxItems = input.maxItems ?? 5;
  const config: DrivePickerConfig = {
    accessToken: input.accessToken,
    apiKey: input.apiKey,
    appId,
    maxItems,
  };

  localStorage.setItem(cfgKey, JSON.stringify(config));

  const url = `${window.location.origin}/drive-picker.html?sid=${encodeURIComponent(id)}`;
  const popup = window.open(
    url,
    'wc-drive-picker',
    'popup=yes,width=1120,height=780,menubar=no,toolbar=no,location=no,status=no',
  );

  if (!popup) {
    localStorage.removeItem(cfgKey);
    throw new Error(
      'Pop-up blocked. Allow pop-ups for WalkCroach, then try Attach → Google Drive again.',
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.clearInterval(poll);
      window.clearTimeout(watchdog);
      localStorage.removeItem(cfgKey);
      localStorage.removeItem(outKey);
    };

    const finish = (ids: string[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ids);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const consume = () => {
      const result = readDrivePickerResult(localStorage.getItem(outKey));
      if (!result) return;
      if (result.type === 'picked') {
        finish(result.fileIds ?? []);
        return;
      }
      if (result.type === 'cancel') {
        finish([]);
        return;
      }
      fail(new Error(result.message || 'Google Drive picker failed.'));
    };

    const poll = window.setInterval(consume, 250);
    consume();

    const watchdog = window.setTimeout(() => {
      fail(
        new Error(
          'Google Drive picker timed out. Leave the Drive window open until you pick files or press Cancel.',
        ),
      );
    }, 180_000);
  });
}
