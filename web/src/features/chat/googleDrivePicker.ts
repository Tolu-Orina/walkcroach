/**
 * Google Drive attach via Google Picker.
 *
 * Research (SO 72193438 + Google issue 278329600): Google Picker’s
 * docs.google.com iframe is incompatible with ANY Cross-Origin-Embedder-Policy
 * on the host document — including `credentialless`. WalkCroach needs COEP for
 * WebContainer, so the picker runs in `/drive-picker.html`, which is served
 * without COEP (Vite middleware + CloudFront behavior), as a popup.
 */

/** Derive Cloud project number from an OAuth web client id when possible. */
export function projectNumberFromClientId(clientId: string): string | null {
  const prefix = clientId.trim().split('-')[0] ?? '';
  return /^\d{6,}$/.test(prefix) ? prefix : null;
}

type HostToPickerMessage = {
  source: 'wc-drive-picker-host';
  type: 'config';
  accessToken: string;
  apiKey: string;
  appId: string;
  maxItems: number;
};

type PickerToHostMessage =
  | { source: 'wc-drive-picker'; type: 'ready' }
  | { source: 'wc-drive-picker'; type: 'picked'; fileIds: string[] }
  | { source: 'wc-drive-picker'; type: 'cancel' }
  | { source: 'wc-drive-picker'; type: 'error'; message: string };

function isPickerMessage(data: unknown): data is PickerToHostMessage {
  return (
    Boolean(data) &&
    typeof data === 'object' &&
    (data as { source?: string }).source === 'wc-drive-picker' &&
    typeof (data as { type?: string }).type === 'string'
  );
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

  const maxItems = input.maxItems ?? 5;
  const origin = window.location.origin;
  const url = `${origin}/drive-picker.html?origin=${encodeURIComponent(origin)}`;
  const popup = window.open(
    url,
    'wc-drive-picker',
    'popup=yes,width=1100,height=720,menubar=no,toolbar=no,location=no,status=no',
  );

  if (!popup) {
    throw new Error(
      'Pop-up blocked. Allow pop-ups for WalkCroach, then try Attach → Google Drive again.',
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(closedPoll);
      window.clearTimeout(watchdog);
    };

    const finish = (ids: string[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        popup.close();
      } catch {
        /* ignore */
      }
      resolve(ids);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        popup.close();
      } catch {
        /* ignore */
      }
      reject(err);
    };

    const sendConfig = () => {
      const msg: HostToPickerMessage = {
        source: 'wc-drive-picker-host',
        type: 'config',
        accessToken: input.accessToken,
        apiKey: input.apiKey,
        appId,
        maxItems,
      };
      popup.postMessage(msg, origin);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      if (!isPickerMessage(event.data)) return;

      if (event.data.type === 'ready') {
        sendConfig();
        return;
      }
      if (event.data.type === 'picked') {
        finish(event.data.fileIds ?? []);
        return;
      }
      if (event.data.type === 'cancel') {
        finish([]);
        return;
      }
      if (event.data.type === 'error') {
        fail(new Error(event.data.message || 'Google Drive picker failed.'));
      }
    };

    window.addEventListener('message', onMessage);

    const closedPoll = window.setInterval(() => {
      if (popup.closed) finish([]);
    }, 400);

    const watchdog = window.setTimeout(() => {
      fail(
        new Error(
          'Google Drive picker timed out. Check that /drive-picker.html loads without COEP, Picker + Drive APIs are enabled, and the API key allows this origin.',
        ),
      );
    }, 120_000);

    // If the popup loaded before we attached the listener, nudge config once.
    window.setTimeout(() => {
      if (!settled && !popup.closed) sendConfig();
    }, 750);
  });
}
