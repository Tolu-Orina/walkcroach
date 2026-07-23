import * as vscode from 'vscode';
import { SECRET_KEYS } from '@walkcroach/agent-engine';
import { generateOAuthState, refreshWithSpaClient } from './pkce.js';
import { getIdeApiBaseUrl } from './session-config.js';

export type AuthSession = {
  accessToken: string;
  signedIn: boolean;
};

type PendingConnect = {
  state: string;
  redirectUri: string;
  resolve: (ok: boolean) => void;
  reject: (err: Error) => void;
};

const IDE_AUTH_PATH = 'walkcroach.walkcroach-ide/auth';

/** Platform-aware deep link: vscode://, cursor://, vscode-insiders://, etc. */
export function ideRedirectUri(uriScheme = vscode.env.uriScheme): string {
  const scheme = (uriScheme || 'vscode').trim() || 'vscode';
  return `${scheme}://${IDE_AUTH_PATH}`;
}

/**
 * Shared Cognito (same SPA client / user pool as Web + Chrome).
 *
 * Industry-standard native handoff:
 * 1. Open Web /connect/ide (reuses normal /signin)
 * 2. Web issues a one-time auth code via BFF
 * 3. IDE deep-link callback carries only code+state (never tokens)
 * 4. Extension exchanges code at POST /ide/v1/oauth/token
 */
export class AuthService {
  private pending: PendingConnect | null = null;
  private refreshInFlight: Promise<string | undefined> | null = null;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getAccessToken(): Promise<string | undefined> {
    const token = await Promise.resolve(
      this.secrets.get(SECRET_KEYS.cognitoAccessToken),
    );
    if (!token) return undefined;

    const expiresAtRaw = await Promise.resolve(
      this.secrets.get(SECRET_KEYS.cognitoExpiresAt),
    );
    const expiresAt = expiresAtRaw ? Number(expiresAtRaw) : NaN;
    if (Number.isFinite(expiresAt) && Date.now() > expiresAt - 60_000) {
      return this.refreshIfPossible();
    }
    return token;
  }

  async isSignedIn(): Promise<boolean> {
    return Boolean(await this.getAccessToken());
  }

  async signOut(): Promise<void> {
    for (const k of [
      SECRET_KEYS.cognitoAccessToken,
      SECRET_KEYS.cognitoRefreshToken,
      SECRET_KEYS.cognitoIdToken,
      SECRET_KEYS.cognitoExpiresAt,
      SECRET_KEYS.pendingPkce,
    ]) {
      await this.secrets.delete(k);
    }
    this.pending = null;
  }

  async storeAccessToken(
    token: string,
    extras?: {
      refreshToken?: string;
      idToken?: string;
      expiresIn?: number;
    },
  ): Promise<void> {
    await this.secrets.store(SECRET_KEYS.cognitoAccessToken, token.trim());
    if (extras?.refreshToken) {
      await this.secrets.store(
        SECRET_KEYS.cognitoRefreshToken,
        extras.refreshToken,
      );
    }
    if (extras?.idToken) {
      await this.secrets.store(SECRET_KEYS.cognitoIdToken, extras.idToken);
    }
    if (extras?.expiresIn) {
      await this.secrets.store(
        SECRET_KEYS.cognitoExpiresAt,
        String(Date.now() + extras.expiresIn * 1000),
      );
    }
  }

  async pasteAccessToken(): Promise<boolean> {
    const token = await vscode.window.showInputBox({
      title: 'WalkCroach: Paste Cognito access token',
      prompt:
        'Advanced fallback: paste an access token from a signed-in WalkCroach Web session',
      password: true,
      ignoreFocusOut: true,
    });
    if (!token?.trim()) return false;
    await this.storeAccessToken(token.trim());
    return true;
  }

  /** Open WalkCroach Web connect flow (shared account). */
  async signInWithWeb(cfg: { webAppUrl: string }): Promise<boolean> {
    if (!cfg.webAppUrl) {
      throw new Error(
        'WalkCroach Web URL is not configured. Set walkcroach.ide.webAppUrl.',
      );
    }

    const state = generateOAuthState();
    const redirectUri = ideRedirectUri();
    await this.secrets.store(
      SECRET_KEYS.pendingPkce,
      JSON.stringify({ state, redirectUri }),
    );

    const authUrl = new URL('/connect/ide', cfg.webAppUrl.replace(/\/$/, ''));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('redirect_uri', redirectUri);

    const result = await new Promise<boolean>((resolve, reject) => {
      this.pending = { state, redirectUri, resolve, reject };
      void vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));
      setTimeout(() => {
        if (this.pending?.state === state) {
          this.pending = null;
          void this.secrets.delete(SECRET_KEYS.pendingPkce);
          reject(new Error('Sign-in timed out'));
        }
      }, 5 * 60_000);
    });

    return result;
  }

  async handleAuthCallback(uri: vscode.Uri): Promise<void> {
    const params = new URLSearchParams(uri.query);
    const state = params.get('state');
    const code = params.get('code');
    const err = params.get('error');

    let pending = this.pending;
    if (!pending) {
      const raw = await Promise.resolve(
        this.secrets.get(SECRET_KEYS.pendingPkce),
      );
      if (raw) {
        try {
          const stored = JSON.parse(raw) as {
            state: string;
            redirectUri?: string;
          };
          pending = {
            state: stored.state,
            redirectUri: stored.redirectUri || ideRedirectUri(),
            resolve: () => undefined,
            reject: () => undefined,
          };
        } catch {
          pending = null;
        }
      }
    }

    if (!pending) return;

    if (err) {
      this.pending = null;
      await this.secrets.delete(SECRET_KEYS.pendingPkce);
      pending.reject(new Error(err));
      return;
    }
    if (!state || state !== pending.state) {
      this.pending = null;
      await this.secrets.delete(SECRET_KEYS.pendingPkce);
      pending.reject(new Error('Invalid callback (state mismatch)'));
      return;
    }
    if (!code) {
      this.pending = null;
      await this.secrets.delete(SECRET_KEYS.pendingPkce);
      pending.reject(
        new Error(
          'Auth callback missing code. Deploy the latest WalkCroach Web + IDE BFF.',
        ),
      );
      return;
    }

    this.pending = null;
    await this.secrets.delete(SECRET_KEYS.pendingPkce);

    try {
      const tokens = await exchangeAuthCode({
        code,
        state,
        redirectUri: pending.redirectUri || ideRedirectUri(),
      });
      await this.storeAccessToken(tokens.id_token ?? tokens.access_token, {
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token ?? tokens.access_token,
        expiresIn: tokens.expires_in ?? 3600,
      });
      pending.resolve(true);
    } catch (e) {
      pending.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private async refreshIfPossible(): Promise<string | undefined> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      try {
        const refreshToken = await Promise.resolve(
          this.secrets.get(SECRET_KEYS.cognitoRefreshToken),
        );
        if (!refreshToken) {
          return Promise.resolve(
            this.secrets.get(SECRET_KEYS.cognitoAccessToken),
          );
        }
        const cfg = getCognitoConfig();
        if (!cfg.clientId || !cfg.region) {
          return Promise.resolve(
            this.secrets.get(SECRET_KEYS.cognitoAccessToken),
          );
        }
        const tokens = await refreshWithSpaClient({
          region: cfg.region,
          clientId: cfg.clientId,
          refreshToken,
        });
        await this.storeAccessToken(tokens.id_token ?? tokens.access_token, {
          refreshToken: tokens.refresh_token ?? refreshToken,
          idToken: tokens.id_token,
          expiresIn: tokens.expires_in,
        });
        return tokens.id_token ?? tokens.access_token;
      } catch {
        return Promise.resolve(
          this.secrets.get(SECRET_KEYS.cognitoAccessToken),
        );
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }
}

async function exchangeAuthCode(params: {
  code: string;
  state: string;
  redirectUri: string;
}): Promise<{
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}> {
  const base = getIdeApiBaseUrl();
  const res = await fetch(`${base}/ide/v1/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(params),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error || `Token exchange failed (${res.status})`);
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    id_token: data.id_token,
    expires_in: data.expires_in,
  };
}

export function getCognitoConfig(): {
  webAppUrl: string;
  clientId: string;
  region: string;
  userPoolId: string;
} {
  const c = vscode.workspace.getConfiguration('walkcroach.ide');
  return {
    webAppUrl: String(c.get('webAppUrl') ?? ''),
    clientId: String(c.get('cognitoClientId') ?? ''),
    region: String(c.get('cognitoRegion') ?? 'eu-west-2'),
    userPoolId: String(c.get('cognitoUserPoolId') ?? ''),
  };
}

export { getIdeApiBaseUrl } from './session-config.js';
