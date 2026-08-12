/**
 * Google Picker loader for Drive attach (`drive.file`).
 *
 * WalkCroach serves COOP/COEP for WebContainer. Google’s picker iframe
 * (docs.google.com) does not send CORP, so under COEP it paints as a gray
 * “sad face” unless the iframe is marked `credentialless` before navigation.
 *
 * Also required by Google for drive.file:
 * - setAppId(Cloud project number)
 * - setOAuthToken + setDeveloperKey
 * - DocsView LIST mode (no thumbnail access on drive.file)
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
  setEnableDrives?: (v: boolean) => DocsView;
};

type GooglePickerBuilder = {
  addView: (view: unknown) => GooglePickerBuilder;
  enableFeature: (feature: unknown) => GooglePickerBuilder;
  disableFeature?: (feature: unknown) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId: (id: string) => GooglePickerBuilder;
  setOrigin: (origin: string) => GooglePickerBuilder;
  setRelayUrl?: (url: string) => GooglePickerBuilder;
  setCallback: (cb: (data: PickerCallbackData) => void) => GooglePickerBuilder;
  setTitle?: (title: string) => GooglePickerBuilder;
  setMaxItems?: (n: number) => GooglePickerBuilder;
  setSize?: (w: number, h: number) => GooglePickerBuilder;
  toUri?: () => { toString: () => string } | string;
  build: () => { setVisible: (v: boolean) => void; dispose?: () => void };
};

type GooglePickerNs = {
  PickerBuilder: new () => GooglePickerBuilder;
  ViewId: { DOCS: unknown };
  DocsView?: new (viewId?: unknown) => DocsView;
  DocsViewMode?: { LIST: unknown; GRID: unknown };
  Feature: {
    MULTISELECT_ENABLED: unknown;
    SUPPORT_DRIVES?: unknown;
    NAV_HIDDEN?: unknown;
  };
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

function isPickerFrameUrl(url: string): boolean {
  try {
    const u = new URL(url, window.location.href);
    return (
      u.hostname === 'docs.google.com' ||
      u.hostname.endsWith('.google.com') ||
      u.pathname.includes('picker')
    );
  } catch {
    return /google\.com|picker/i.test(url);
  }
}

/**
 * COEP blocks Google Picker iframes unless they are credentialless.
 * Patch HTMLIFrameElement.src so credentialless is set before navigation.
 */
function installCredentiallessIframePatch(): () => void {
  const proto = HTMLIFrameElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'src');
  if (!desc?.set || !desc.get) return () => undefined;

  const originalSet = desc.set;
  const originalGet = desc.get;

  Object.defineProperty(proto, 'src', {
    configurable: true,
    enumerable: desc.enumerable,
    get() {
      return originalGet.call(this);
    },
    set(value: string) {
      if (typeof value === 'string' && isPickerFrameUrl(value)) {
        try {
          (this as HTMLIFrameElement & { credentialless?: boolean }).credentialless =
            true;
          this.setAttribute('credentialless', '');
        } catch {
          /* older browsers */
        }
      }
      originalSet.call(this, value);
    },
  });

  return () => {
    Object.defineProperty(proto, 'src', desc);
  };
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
    view.setEnableDrives?.(true);
    return view;
  }
  return pickerApi.ViewId.DOCS;
}

function coepHint(): string {
  if (typeof window.crossOriginIsolated === 'boolean' && window.crossOriginIsolated) {
    return ' This page is cross-origin isolated (COEP) for App Builder; if the picker stays blank, your browser may not support credentialless iframes — try Chrome/Edge, or disable extensions that block Google frames.';
  }
  return '';
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

  const restoreSrc = installCredentiallessIframePatch();
  const pickerApi = await ensurePickerApi();
  const maxItems = input.maxItems ?? 5;
  const origin = window.location.origin;

  return new Promise((resolve, reject) => {
    let settled = false;
    let pickerInstance: { setVisible: (v: boolean) => void; dispose?: () => void } | null =
      null;
    let sawLoaded = false;

    const cleanup = () => {
      restoreSrc();
      window.clearTimeout(watchdog);
      window.clearTimeout(loadedWatchdog);
      window.removeEventListener('keydown', onKey);
      try {
        pickerInstance?.setVisible(false);
        pickerInstance?.dispose?.();
      } catch {
        /* ignore */
      }
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

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish([]);
    };

    const loadedWatchdog = window.setTimeout(() => {
      if (!sawLoaded) {
        fail(
          new Error(
            `Google Drive picker frame did not load.${coepHint()} Also verify Picker API + Drive API are enabled, the API key allows this origin, and google_cloud_project_number matches the OAuth project.`,
          ),
        );
      }
    }, 12_000);

    const watchdog = window.setTimeout(() => {
      fail(
        new Error(
          `Google Drive picker timed out.${coepHint()} Press Escape to dismiss, then retry after checking API key / project number / reconnecting Drive.`,
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
          if (
            pickerApi.Action.LOADED &&
            data.action === pickerApi.Action.LOADED
          ) {
            sawLoaded = true;
            window.clearTimeout(loadedWatchdog);
            return;
          }
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
        });

      if (typeof builder.setRelayUrl === 'function') {
        builder = builder.setRelayUrl(origin);
      }
      if (typeof builder.setMaxItems === 'function') {
        builder = builder.setMaxItems(maxItems);
      }
      if (typeof builder.setTitle === 'function') {
        builder = builder.setTitle('Attach from Google Drive');
      }
      if (typeof builder.setSize === 'function') {
        builder = builder.setSize(1050, 650);
      }
      // Hide nav chrome that expects thumbnail / full-drive scopes.
      if (pickerApi.Feature.NAV_HIDDEN && typeof builder.enableFeature === 'function') {
        builder = builder.enableFeature(pickerApi.Feature.NAV_HIDDEN);
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
