/**
 * Google Picker loader for Drive attach (drive.file).
 * Token and API key come from POST /connectors/google_drive/picker-session.
 */

type PickerDoc = { id: string; name?: string; mimeType?: string };

type PickerCallbackData = {
  action: string;
  docs?: PickerDoc[];
};

type GooglePickerBuilder = {
  addView: (view: unknown) => GooglePickerBuilder;
  enableFeature: (feature: unknown) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId?: (id: string) => GooglePickerBuilder;
  setCallback: (cb: (data: PickerCallbackData) => void) => GooglePickerBuilder;
  setTitle?: (title: string) => GooglePickerBuilder;
  setMaxItems?: (n: number) => GooglePickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
};

type GooglePickerNs = {
  PickerBuilder: new () => GooglePickerBuilder;
  ViewId: { DOCS: unknown };
  Feature: { MULTISELECT_ENABLED: unknown; SUPPORT_DRIVES?: unknown };
  Action: { PICKED: string; CANCEL: string };
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

  await new Promise<void>((resolve) => {
    gapi.load('picker', () => resolve());
  });

  const picker = window.google?.picker;
  if (!picker) throw new Error('Google Picker failed to initialize');
  return picker;
}

export async function openGoogleDrivePicker(input: {
  accessToken: string;
  apiKey: string;
  clientId?: string;
  maxItems?: number;
}): Promise<string[]> {
  const pickerApi = await ensurePickerApi();
  const maxItems = input.maxItems ?? 5;

  return new Promise((resolve, reject) => {
    try {
      let builder = new pickerApi.PickerBuilder()
        .addView(pickerApi.ViewId.DOCS)
        .enableFeature(pickerApi.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(input.accessToken)
        .setDeveloperKey(input.apiKey)
        .setCallback((data) => {
          if (data.action === pickerApi.Action.CANCEL) {
            resolve([]);
            return;
          }
          if (data.action === pickerApi.Action.PICKED) {
            const ids = (data.docs ?? [])
              .map((d) => d.id)
              .filter((id): id is string => Boolean(id));
            resolve(ids);
          }
        });

      if (typeof builder.setMaxItems === 'function') {
        builder = builder.setMaxItems(maxItems);
      }
      if (typeof builder.setTitle === 'function') {
        builder = builder.setTitle('Attach from Google Drive');
      }

      if (input.clientId && typeof builder.setAppId === 'function') {
        const appId = input.clientId.split('-')[0];
        if (appId) builder = builder.setAppId(appId);
      }

      if (pickerApi.Feature.SUPPORT_DRIVES) {
        builder = builder.enableFeature(pickerApi.Feature.SUPPORT_DRIVES);
      }

      builder.build().setVisible(true);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
