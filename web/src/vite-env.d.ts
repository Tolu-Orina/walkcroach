/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_COGNITO_REGION?: string;
  readonly VITE_ALLOW_DEV_AUTH?: string;
  readonly VITE_GITHUB_APP_ENABLED?: string;
  readonly VITE_ALLOW_GITHUB_PAT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
