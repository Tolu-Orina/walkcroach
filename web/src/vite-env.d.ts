/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_IDE_API_URL?: string;
  readonly VITE_CHROME_API_URL?: string;
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_COGNITO_REGION?: string;
  readonly VITE_ALLOW_DEV_AUTH?: string;
  readonly VITE_GITHUB_APP_ENABLED?: string;
  readonly VITE_ALLOW_GITHUB_PAT?: string;
  readonly VITE_SANDBOX_RUNTIME?: string;
  /** Unsigned Windows Desktop IDE preview zip / Release asset URL. */
  readonly VITE_DESKTOP_DOWNLOAD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
