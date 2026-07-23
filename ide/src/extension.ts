import * as vscode from 'vscode';
import { WalkCroachSidebarProvider } from './host/webviewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new WalkCroachSidebarProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      WalkCroachSidebarProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('walkcroach.ping', async () => {
      await provider.pingFromCommand();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('walkcroach.openPanel', async () => {
      await vscode.commands.executeCommand('walkcroach.sidebar.focus');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'walkcroach.configureCockroach',
      async () => {
        await provider.configureCockroach();
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('walkcroach.signIn', async () => {
      await provider.signInWithWeb();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('walkcroach.pasteToken', async () => {
      await provider.pasteToken();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('walkcroach.signOut', async () => {
      await provider.signOut();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('walkcroach.linkProject', async () => {
      await provider.linkProject();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('walkcroach.unlinkProject', async () => {
      await provider.unlinkProject();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'walkcroach.viewMirroredMemory',
      async () => {
        await provider.viewMirroredMemory();
      },
    ),
  );

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: (uri) => {
        void provider.handleAuthUri(uri);
      },
    }),
  );

  context.subscriptions.push({
    dispose: () => provider.dispose(),
  });

  context.subscriptions.push(
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      provider.notifyTrustChanged();
      void vscode.commands.executeCommand('walkcroach.openPanel');
    }),
  );
}

export function deactivate(): void {}
