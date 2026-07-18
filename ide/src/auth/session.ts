import * as vscode from 'vscode';
import { SECRET_KEYS } from '@walkcroach/agent-engine';
import {
  buildAuthorizeUrl,
  codeChallengeS256,
  exchangeAuthorizationCode,
  generateCodeVerifier,
  generateOAuthState,
  refreshAccessToken,
} from './pkce.js';

export type AuthSession = {
  accessToken: string;
  signedIn: boolean;
};

type PendingPkceStored = {
  verifier: string;
  state: string;
  redirectUri: string;
};

type PendingPkce = PendingPkceStored & {
  resolve: (ok: boolean) => void;
  reject: (err: Error) => void;
};

/**
 * Cognito session in SecretStorage (NFR-D04).
 * Primary: Hosted UI authorization-code + PKCE.
 * Fallback: paste access token (Chrome-compatible) for local/dev.
 */
export class AuthService {
  private pending: PendingPkce | null = null;
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
    // Refresh ~60s before expiry when we have a refresh token.
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

  /** Paste Cognito access token (local/dev when Hosted UI not configured). */
  async pasteAccessToken(): Promise<boolean> {
    const token = await vscode.window.showInputBox({
      title: 'WalkCroach: Paste Cognito access token',
      prompt: 'Paste a Cognito access token from the Web app or AWS CLI',
      password: true,
      ignoreFocusOut: true,
    });
    if (!token?.trim()) return false;
    await this.storeAccessToken(token.trim());
    return true;
  }

  /**
   * Start PKCE sign-in via Cognito Hosted UI.
   * Pending verifier/state is persisted to SecretStorage so a callback after
   * extension host restart can still complete the exchange.
   */
  async signInWithPkce(cfg: {
    hostedUiBaseUrl: string;
    clientId: string;
  }): Promise<boolean> {
    if (!cfg.hostedUiBaseUrl || !cfg.clientId) {
      throw new Error(
        'Cognito Hosted UI is not configured. Set walkcroach.ide.cognitoHostedUiUrl and walkcroach.ide.cognitoClientId, or use Paste token.',
      );
    }

    const verifier = generateCodeVerifier();
    const challenge = codeChallengeS256(verifier);
    const state = generateOAuthState();
    const redirectUri = 'vscode://walkcroach.walkcroach-ide/auth';

    const stored: PendingPkceStored = { verifier, state, redirectUri };
    await this.secrets.store(
      SECRET_KEYS.pendingPkce,
      JSON.stringify(stored),
    );

    const url = buildAuthorizeUrl({
      hostedUiBaseUrl: cfg.hostedUiBaseUrl,
      clientId: cfg.clientId,
      redirectUri,
      codeChallenge: challenge,
      state,
    });

    const result = await new Promise<boolean>((resolve, reject) => {
      this.pending = {
        ...stored,
        resolve,
        reject,
      };
      void vscode.env.openExternal(vscode.Uri.parse(url));
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
    const code = params.get('code');
    const state = params.get('state');
    const err = params.get('error');

    let pending = this.pending;
    if (!pending) {
      const raw = await Promise.resolve(
        this.secrets.get(SECRET_KEYS.pendingPkce),
      );
      if (raw) {
        try {
          const stored = JSON.parse(raw) as PendingPkceStored;
          pending = {
            ...stored,
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
    if (!code || !state || state !== pending.state) {
      this.pending = null;
      await this.secrets.delete(SECRET_KEYS.pendingPkce);
      pending.reject(new Error('Invalid OAuth callback (state/code mismatch)'));
      return;
    }

    this.pending = null;
    await this.secrets.delete(SECRET_KEYS.pendingPkce);

    try {
      const cfg = getCognitoConfig();
      const tokens = await exchangeAuthorizationCode({
        hostedUiBaseUrl: cfg.hostedUiBaseUrl,
        clientId: cfg.clientId,
        redirectUri: pending.redirectUri,
        code,
        codeVerifier: pending.verifier,
      });
      await this.storeAccessToken(tokens.access_token, {
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        expiresIn: tokens.expires_in,
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
        if (!cfg.hostedUiBaseUrl || !cfg.clientId) {
          return Promise.resolve(
            this.secrets.get(SECRET_KEYS.cognitoAccessToken),
          );
        }
        const tokens = await refreshAccessToken({
          hostedUiBaseUrl: cfg.hostedUiBaseUrl,
          clientId: cfg.clientId,
          refreshToken,
        });
        await this.storeAccessToken(tokens.access_token, {
          refreshToken: tokens.refresh_token ?? refreshToken,
          idToken: tokens.id_token,
          expiresIn: tokens.expires_in,
        });
        return tokens.access_token;
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

export function getCognitoConfig(): {
  hostedUiBaseUrl: string;
  clientId: string;
  region: string;
  userPoolId: string;
} {
  const c = vscode.workspace.getConfiguration('walkcroach.ide');
  return {
    hostedUiBaseUrl: String(c.get('cognitoHostedUiUrl') ?? ''),
    clientId: String(c.get('cognitoClientId') ?? ''),
    region: String(c.get('cognitoRegion') ?? 'eu-west-2'),
    userPoolId: String(c.get('cognitoUserPoolId') ?? ''),
  };
}

export function getIdeApiBaseUrl(): string {
  const c = vscode.workspace.getConfiguration('walkcroach.ide');
  return String(c.get('apiBaseUrl') ?? 'http://localhost:3003').replace(
    /\/$/,
    '',
  );
}
