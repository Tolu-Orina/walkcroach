import { vi } from 'vitest';

export const workspace = {
  getConfiguration: vi.fn(() => ({
    get: vi.fn((key: string) => {
      const map: Record<string, string> = {
        webAppUrl: 'https://walkcroach.test',
        cognitoClientId: 'client-123',
        cognitoRegion: 'eu-west-2',
        cognitoUserPoolId: 'pool-1',
        apiBaseUrl: 'http://localhost:3003',
      };
      return map[key] ?? '';
    }),
  })),
  workspaceFolders: [],
  onDidChangeWorkspaceFolders: vi.fn(),
};

export const window = {
  showInputBox: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  registerWebviewViewProvider: vi.fn(),
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  })),
};

export const commands = {
  registerCommand: vi.fn(),
  executeCommand: vi.fn(),
};

export class Uri {
  static parse(value: string): Uri {
    const u = new URL(value);
    return new Uri(u.protocol.replace(/:$/, ''), u.hostname, u.pathname, u.search.replace(/^\?/, ''));
  }
  constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query: string = '',
  ) {}
}

export const env = {
  openExternal: vi.fn().mockResolvedValue(true),
  uriScheme: 'vscode',
};

export class EventEmitter {
  event = vi.fn();
  fire = vi.fn();
  dispose = vi.fn();
}

export type SecretStorage = {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
  onDidChange: (...args: unknown[]) => unknown;
};
