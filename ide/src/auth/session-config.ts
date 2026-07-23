import * as vscode from 'vscode';

export function getIdeApiBaseUrl(): string {
  const c = vscode.workspace.getConfiguration('walkcroach.ide');
  return String(c.get('apiBaseUrl') ?? 'http://localhost:3003').replace(
    /\/$/,
    '',
  );
}
