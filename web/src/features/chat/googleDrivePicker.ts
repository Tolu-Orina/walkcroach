/**
 * Google Picker loader for Drive attach (`drive.file`).
 *
 * Google requires (verified against Picker docs):
 * - OAuth access token (`setOAuthToken`)
 * - API key / developer key (`setDeveloperKey`)
 * - Cloud **project number** as `setAppId` — **required** for `drive.file`
 * - Prefer `DocsView` + `DocsViewMode.LIST` when not using full drive/readonly scopes
 * - `setOrigin` to the top-level page origin
 *
 * Token / apiKey / appId come from POST /connectors/google_drive/picker-session.
 */

type PickerDoc = { id: string; name?: string; mimeType?: string };

type PickerCallbackData = {
  action: string;
  docs?: PickerDoc[];
};

type DocsView = {
  setMode: (mode: unknown) => DocsView;
  setIncludeFolders?: (v: boolean) => DocsView;
  setSelectFolderEnabled?: (v: boolean) => DocsView;
};

type GooglePickerBuilder = {
  addView: (view: unknown) => GooglePickerBuilder;
  enableFeature: (feature: unknown) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId: (id: string) => GooglePickerBuilder;
  setOrigin: (origin: string) => GooglePickerBuilder;
  setCallback: (cb: (data: PickerCallbackData) => void) => GooglePickerBuilder;
  setTitle?: (title: string) => GooglePickerBuilder;
  setMaxItems?: (n: number) => GooglePickerBuilder;
  setSize?: (w: number, h: number) => GooglePickerBuilder;
  build: () => { setVisible: (v: boolean) => void; dispose?: () => void };
};

type GooglePickerNs = {
  PickerBuilder: new () => GooglePickerBuilder;
  ViewId: { DOCS: unknown };
  DocsView?: new (viewId?: unknown) => DocsView;
  DocsViewMode?: { LIST: unknown; GRID: unknown };
  Feature: { MULTISELECT_ENABLED: unknown; SUPPORT_DRIVES?: unknown };
  Action: { PICKED: string; CANCEL: string; LOADED?: string };
};

declare global {
  interface Window {
    gapi?: {
      load: (name: string, cb: () => void) => void;
    };
    google?: {
      picker?: GooglePickerNs;
    };
  }
}

/** Derive Cloud project number from an OAuth web client id when possible. */
export function projectNumberFromClientId(clientId: string): string | null {
  const prefix = clientId.trim().split('-')[0] ?? '';
  return /^\d{6,}$/.test(prefix) ? prefix : null;
}

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${src}"]`,
  );
  if (existing) {
    return existing.dataset.loaded === '1'
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          existing.addEventListener('load', () => resolve());
          existing.addEventListener('error', () =>
            reject(new Error('Failed to load Google API script')),
          );
        });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = '1';
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load Google API script'));
    document.head.appendChild(script);
  });
}

async function ensurePickerApi(): Promise<GooglePickerNs> {
  await loadScript('https://apis.google.com/js/api.js');
  const gapi = window.gapi;
  if (!gapi) throw new Error('Google API failed to initialize');

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error('Timed out loading Google Picker API')),
      15_000,
    );
    try {
      gapi.load('picker', () => {
        window.clearTimeout(timeout);
        resolve();
      });
    } catch (err) {
      window.clearTimeout(timeout);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });

  const picker = window.google?.picker;
  if (!picker) throw new Error('Google Picker failed to initialize');
  return picker;
}

function buildDocsView(pickerApi: GooglePickerNs): unknown {
  // drive.file cannot load thumbnails — LIST mode is required for a usable UI.
  if (pickerApi.DocsView && pickerApi.DocsViewMode?.LIST) {
    const view = new pickerApi.DocsView(pickerApi.ViewId.DOCS);
    view.setMode(pickerApi.DocsViewMode.LIST);
    view.setIncludeFolders?.(true);
    view.setSelectFolderEnabled?.(false);
    return view;
  }
  return pickerApi.ViewId.DOCS;
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

  const pickerApi = await ensurePickerApi();
  const maxItems = input.maxItems ?? 5;
  const origin = `${window.location.protocol}//${window.location.host}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    let pickerInstance: { setVisible: (v: boolean) => void; dispose?: () => void } | null =
      null;

    const finish = (ids: string[]) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      window.removeEventListener('keydown', onKey);
      try {
        pickerInstance?.setVisible(false);
        pickerInstance?.dispose?.();
      } catch {
        /* ignore */
      }
      resolve(ids);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      window.removeEventListener('keydown', onKey);
      try {
        pickerInstance?.setVisible(false);
        pickerInstance?.dispose?.();
      } catch {
        /* ignore */
      }
      reject(err);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish([]);
    };

    // If the inner iframe dies (wrong appId / API key / origin), CANCEL never fires.
    const watchdog = window.setTimeout(() => {
      fail(
        new Error(
          'Google Drive picker did not load. Check: (1) Google Picker API + Drive API enabled, (2) API key allows this site origin and Picker API, (3) google_cloud_project_number matches the Cloud project of the OAuth client, (4) reconnect Google Drive after scope changes.',
        ),
      );
    }, 45_000);

    window.addEventListener('keydown', onKey);

    try {
      let builder = new pickerApi.PickerBuilder()
        .addView(buildDocsView(pickerApi))
        .enableFeature(pickerApi.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(input.accessToken)
        .setDeveloperKey(input.apiKey)
        .setAppId(appId)
        .setOrigin(origin)
        .setCallback((data) => {
          if (data.action === pickerApi.Action.CANCEL) {
            finish([]);
            return;
          }
          if (data.action === pickerApi.Action.PICKED) {
            const ids = (data.docs ?? [])
              .map((d) => d.id)
              .filter((id): id is string => Boolean(id));
            finish(ids);
          }
          // LOADED: keep waiting for pick/cancel
        });

      if (typeof builder.setMaxItems === 'function') {
        builder = builder.setMaxItems(maxItems);
      }
      if (typeof builder.setTitle === 'function') {
        builder = builder.setTitle('Attach from Google Drive');
      }
      if (typeof builder.setSize === 'function') {
        builder = builder.setSize(1050, 650);
      }

      if (pickerApi.Feature.SUPPORT_DRIVES) {
        builder = builder.enableFeature(pickerApi.Feature.SUPPORT_DRIVES);
      }

      pickerInstance = builder.build();
      pickerInstance.setVisible(true);
    } catch (err) {
      fail(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
