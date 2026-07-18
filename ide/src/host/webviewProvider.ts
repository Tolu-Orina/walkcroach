import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import {
  runAgentLoop,
  loadMcpConfigFromSecrets,
  SECRET_KEYS,
  parseMcpConfigSnippet,
  DEFAULT_MCP_URL,
  normalizeLocalRepoKey,
} from '@walkcroach/agent-engine';
import type { HostToWebviewMessage } from '@walkcroach/agent-engine';
import {
  AuthService,
  getCognitoConfig,
} from '../auth/session.js';
import {
  createProjectMemoryBridge,
  listMyProjects,
  createLink,
  deleteLink,
  listMemoryEntries,
  updateMemoryEntry,
  ideMe,
} from '../api/ideClient.js';
import { VsCodeHostAdapter } from './VsCodeHostAdapter';
import { MessageBridge } from './messageBridge';

const execFileAsync = promisify(execFile);

const TRANSCRIPT_KEY = 'walkcroach.session.transcript';
const AUTONOMY_KEY = 'walkcroach.session.autonomy';

type PendingApproval = Extract<
  HostToWebviewMessage,
  { type: 'APPROVAL_REQUEST' }
>;

export class WalkCroachSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'walkcroach.sidebar';

  private view?: vscode.WebviewView;
  private bridge?: MessageBridge;
  private abort?: AbortController;
  private transcript = '';
  private streaming = false;
  private pendingApproval: PendingApproval | null = null;
  private telemetry: Record<string, number> = {};
  private mcpConfigured = false;
  private signedIn = false;
  private linkedProjectId: string | null = null;
  private linkedProjectName: string | null = null;
  private linkId: string | undefined;
  private readonly auth: AuthService;
  private readonly output: vscode.OutputChannel;
  private readonly host: VsCodeHostAdapter;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.auth = new AuthService(context.secrets);
    this.output = vscode.window.createOutputChannel('WalkCroach');
    this.transcript =
      context.workspaceState.get<string>(TRANSCRIPT_KEY) ?? '';
    const autonomy =
      context.workspaceState.get<'strict' | 'low_friction'>(AUTONOMY_KEY) ??
      'strict';

    this.host = new VsCodeHostAdapter((event) => {
      if (event.type === 'token_delta') {
        this.transcript += event.text;
      }
      if (event.type === 'approval_request') {
        const r = event.request;
        this.pendingApproval = {
          type: 'APPROVAL_REQUEST',
          stepId: r.stepId,
          kind: r.kind,
          toolName: r.toolName,
          path: r.path,
          before: r.before,
          after: r.after,
          cmd: r.cmd,
        };
      }
      if (event.type === 'cache_usage') {
        this.output.appendLine(
          `cache read=${event.cacheReadInputTokens} write=${event.cacheWriteInputTokens}`,
        );
      }
      if (event.type === 'telemetry') {
        if (event.counters) this.telemetry = { ...event.counters };
        this.output.appendLine(
          `telemetry ${event.name}${event.detail ? ` ${event.detail}` : ''} ${JSON.stringify(this.telemetry)}`,
        );
      }
      this.bridge?.onAgentEvent(event);
      // Advisory warnings / non-fatal errors must not end the run.
      const endRun =
        event.type === 'done' ||
        (event.type === 'error' && event.fatal !== false);
      if (endRun) {
        this.streaming = false;
        this.pendingApproval = null;
        this.abort = undefined;
        this.host.setRunSignal(undefined);
        void this.persistTranscript();
        this.snapshot();
      }
    }, this.output);

    this.host.bindSecrets(context.secrets);
    this.host.setAutonomy(autonomy);
    void this.refreshMcpConfigured();
    void this.refreshAuthAndLink();
  }

  async configureCockroach(): Promise<void> {
    const mode = await vscode.window.showQuickPick(
      [
        {
          label: 'Paste MCP console snippet (JSON)',
          description:
            'Cluster ID + API key from CockroachDB Cloud Connect → MCP',
        },
        {
          label: 'Enter cluster ID + API key manually',
        },
        {
          label: 'Set ccloud service-account API key only',
        },
        {
          label: 'Clear CockroachDB secrets',
        },
      ],
      { title: 'WalkCroach: Configure CockroachDB' },
    );
    if (!mode) return;

    if (mode.label.startsWith('Clear')) {
      for (const k of [
        SECRET_KEYS.mcpUrl,
        SECRET_KEYS.mcpClusterId,
        SECRET_KEYS.mcpApiKey,
        SECRET_KEYS.ccloudApiKey,
      ]) {
        await this.context.secrets.delete(k);
      }
      this.mcpConfigured = false;
      this.snapshot();
      void vscode.window.showInformationMessage(
        'WalkCroach CockroachDB secrets cleared.',
      );
      return;
    }

    if (mode.label.startsWith('Paste')) {
      const raw = await vscode.window.showInputBox({
        title: 'MCP config JSON snippet',
        prompt:
          'Paste the Cloud Console MCP JSON (headers with mcp-cluster-id + Bearer key)',
        ignoreFocusOut: true,
      });
      if (!raw) return;
      try {
        const parsed = parseMcpConfigSnippet(raw);
        if (!parsed.clusterId || !parsed.apiKey) {
          throw new Error(
            'Snippet must include mcp-cluster-id and Authorization Bearer key.',
          );
        }
        await this.context.secrets.store(
          SECRET_KEYS.mcpClusterId,
          parsed.clusterId,
        );
        await this.context.secrets.store(SECRET_KEYS.mcpApiKey, parsed.apiKey);
        await this.context.secrets.store(
          SECRET_KEYS.mcpUrl,
          parsed.url ?? DEFAULT_MCP_URL,
        );
        const existingCcloud = await this.context.secrets.get(
          SECRET_KEYS.ccloudApiKey,
        );
        if (!existingCcloud) {
          await this.context.secrets.store(
            SECRET_KEYS.ccloudApiKey,
            parsed.apiKey,
          );
        }
        this.mcpConfigured = true;
        this.snapshot();
        void vscode.window.showInformationMessage(
          'CockroachDB MCP credentials saved to SecretStorage.',
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(message);
      }
      return;
    }

    if (mode.label.startsWith('Set ccloud')) {
      const key = await vscode.window.showInputBox({
        title: 'ccloud service-account API key',
        password: true,
        ignoreFocusOut: true,
      });
      if (!key) return;
      await this.context.secrets.store(SECRET_KEYS.ccloudApiKey, key);
      void vscode.window.showInformationMessage('ccloud API key saved.');
      return;
    }

    const clusterId = await vscode.window.showInputBox({
      title: 'Cluster ID',
      ignoreFocusOut: true,
    });
    if (!clusterId) return;
    const apiKey = await vscode.window.showInputBox({
      title: 'Service-account API key',
      password: true,
      ignoreFocusOut: true,
    });
    if (!apiKey) return;
    await this.context.secrets.store(SECRET_KEYS.mcpClusterId, clusterId);
    await this.context.secrets.store(SECRET_KEYS.mcpApiKey, apiKey);
    await this.context.secrets.store(SECRET_KEYS.mcpUrl, DEFAULT_MCP_URL);
    const existingCcloud = await this.context.secrets.get(
      SECRET_KEYS.ccloudApiKey,
    );
    if (!existingCcloud) {
      await this.context.secrets.store(SECRET_KEYS.ccloudApiKey, apiKey);
    }
    this.mcpConfigured = true;
    this.snapshot();
    void vscode.window.showInformationMessage(
      'CockroachDB credentials saved to SecretStorage.',
    );
  }

  async signInPkce(): Promise<void> {
    const cfg = getCognitoConfig();
    if (!cfg.hostedUiBaseUrl || !cfg.clientId) {
      void vscode.window.showInformationMessage(
        'Cognito Hosted UI is not configured. Use “WalkCroach: Paste Token” or set walkcroach.ide.cognitoHostedUiUrl and walkcroach.ide.cognitoClientId.',
      );
      return;
    }
    try {
      await this.auth.signInWithPkce({
        hostedUiBaseUrl: cfg.hostedUiBaseUrl,
        clientId: cfg.clientId,
      });
      await this.refreshAuthAndLink();
      void vscode.window.showInformationMessage('Signed in to WalkCroach.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Sign-in failed: ${message}`);
    }
  }

  async pasteToken(): Promise<void> {
    const ok = await this.auth.pasteAccessToken();
    if (!ok) return;
    await this.refreshAuthAndLink();
    void vscode.window.showInformationMessage('Access token saved.');
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    this.signedIn = false;
    this.linkedProjectId = null;
    this.linkedProjectName = null;
    this.linkId = undefined;
    this.snapshot();
    void vscode.window.showInformationMessage('Signed out of WalkCroach.');
  }

  async handleAuthUri(uri: vscode.Uri): Promise<void> {
    try {
      await this.auth.handleAuthCallback(uri);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Auth callback failed: ${message}`);
    }
  }

  async linkProject(): Promise<void> {
    const token = await this.auth.getAccessToken();
    if (!token) {
      void vscode.window.showWarningMessage(
        'Sign in first (WalkCroach: Sign In or Paste Token).',
      );
      return;
    }

    let projects;
    try {
      projects = await listMyProjects(token);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Failed to list projects: ${message}`);
      return;
    }

    if (!projects.length) {
      void vscode.window.showInformationMessage(
        'No WalkCroach projects found. Create one in the Web app first.',
      );
      return;
    }

    const picked = await vscode.window.showQuickPick(
      projects.map((p) => ({
        label: p.name,
        description: p.id,
        project: p,
      })),
      { title: 'Link local repo to WalkCroach project' },
    );
    if (!picked) return;

    const workspacePath = this.host.getWorkspaceRoot();
    const gitRemoteUrl = await this.getGitRemoteUrl();

    try {
      const link = await createLink(token, {
        projectId: picked.project.id,
        gitRemoteUrl: gitRemoteUrl ?? undefined,
        workspacePath: workspacePath ?? undefined,
        localRepoDisplay: workspacePath
          ? workspacePath.split(/[/\\]/).pop()
          : undefined,
      });
      this.linkId = link.id;
      this.linkedProjectId = link.projectId;
      this.linkedProjectName =
        link.projectName ?? picked.project.name ?? null;
      this.signedIn = true;
      this.snapshot();
      void vscode.window.showInformationMessage(
        `Linked to project “${this.linkedProjectName ?? link.projectId}”.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Link failed: ${message}`);
    }
  }

  async unlinkProject(): Promise<void> {
    const token = await this.auth.getAccessToken();
    if (!token) {
      void vscode.window.showWarningMessage('Not signed in.');
      return;
    }
    if (!this.linkId) {
      void vscode.window.showInformationMessage('No project link for this repo.');
      return;
    }

    try {
      await deleteLink(token, this.linkId);
      this.linkId = undefined;
      this.linkedProjectId = null;
      this.linkedProjectName = null;
      this.snapshot();
      void vscode.window.showInformationMessage('Project unlinked.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Unlink failed: ${message}`);
    }
  }

  async viewMirroredMemory(): Promise<void> {
    const token = await this.auth.getAccessToken();
    if (!token) {
      void vscode.window.showWarningMessage('Sign in first.');
      return;
    }
    if (!this.linkedProjectId) {
      void vscode.window.showWarningMessage(
        'Link a project first to view mirrored memory.',
      );
      return;
    }

    let entries;
    try {
      entries = await listMemoryEntries(token, this.linkedProjectId, {
        sourceSurface: 'ide',
        limit: 50,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Failed to list memory: ${message}`);
      return;
    }

    if (!entries.length) {
      void vscode.window.showInformationMessage(
        'No IDE-mirrored memory entries yet.',
      );
      return;
    }

    const picked = await vscode.window.showQuickPick(
      entries.map((e) => ({
        label: e.kind,
        description: e.createdAt,
        detail: e.text.slice(0, 200),
        entry: e,
      })),
      { title: 'IDE-mirrored memory (select to edit)' },
    );
    if (!picked) return;

    const next = await vscode.window.showInputBox({
      title: 'Edit memory entry',
      value: picked.entry.text,
      ignoreFocusOut: true,
      prompt: `Edit ${picked.entry.kind} entry`,
    });
    if (next === undefined || next === picked.entry.text) return;

    try {
      await updateMemoryEntry(
        token,
        picked.entry.id,
        this.linkedProjectId,
        next,
      );
      void vscode.window.showInformationMessage('Memory entry updated.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Update failed: ${message}`);
    }
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    const { webview } = webviewView;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ],
    };

    this.bridge?.dispose();
    this.bridge = new MessageBridge((msg) => {
      void webview.postMessage(msg);
    });

    webview.html = this.getHtml(webview);

    webview.onDidReceiveMessage((raw) => {
      const msg = this.bridge?.parseIncoming(raw);
      if (!msg) {
        this.output.appendLine(
          `Ignored non-allowlisted webview message: ${JSON.stringify(raw)}`,
        );
        return;
      }
      void this.handleMessage(msg);
    });
  }

  async pingFromCommand(): Promise<void> {
    if (!this.view) {
      await vscode.commands.executeCommand('walkcroach.sidebar.focus');
    }
    await this.startTask('ping', 'ping');
  }

  private async refreshMcpConfigured(): Promise<void> {
    const cfg = await loadMcpConfigFromSecrets((k) =>
      Promise.resolve(this.context.secrets.get(k)),
    );
    this.mcpConfigured = Boolean(cfg);
  }

  private authRefreshGen = 0;

  private async refreshAuthAndLink(): Promise<void> {
    const gen = ++this.authRefreshGen;
    const token = await this.auth.getAccessToken();
    if (gen !== this.authRefreshGen) return;

    this.signedIn = Boolean(token);
    if (!token) {
      this.linkedProjectId = null;
      this.linkedProjectName = null;
      this.linkId = undefined;
      this.snapshot();
      return;
    }

    const workspacePath = this.host.getWorkspaceRoot();
    const gitRemoteUrl = await this.getGitRemoteUrl();
    if (gen !== this.authRefreshGen) return;

    let localRepoKey: string | undefined;
    try {
      if (gitRemoteUrl || workspacePath) {
        localRepoKey = normalizeLocalRepoKey({
          workspacePath,
          gitRemoteUrl,
        });
      }
    } catch {
      localRepoKey = undefined;
    }

    // Without a repo key we cannot resolve a link — keep prior link state.
    if (!localRepoKey) {
      this.snapshot();
      return;
    }

    try {
      const me = await ideMe(token, localRepoKey);
      if (gen !== this.authRefreshGen) return;
      if (me.link) {
        this.linkId = me.link.id;
        this.linkedProjectId = me.link.projectId;
        this.linkedProjectName = me.link.projectName ?? null;
      } else {
        this.linkId = undefined;
        this.linkedProjectId = null;
        this.linkedProjectName = null;
      }
    } catch (err) {
      if (gen !== this.authRefreshGen) return;
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`ideMe failed: ${message}`);
      // Keep prior link state if API is unreachable
    }
    this.snapshot();
  }

  private async getGitRemoteUrl(): Promise<string | null> {
    const root = this.host.getWorkspaceRoot();
    if (!root) return null;
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['remote', 'get-url', 'origin'],
        { cwd: root, timeout: 5000 },
      );
      const url = stdout.trim();
      return url || null;
    } catch {
      return null;
    }
  }

  private snapshot(): void {
    this.bridge?.postSnapshot({
      trusted: this.host.isTrustedWorkspace(),
      streaming: this.streaming,
      transcript: this.transcript,
      autonomy: this.host.getAutonomy(),
      pendingApproval: this.pendingApproval,
      mcpConfigured: this.mcpConfigured,
      telemetry: this.telemetry,
      signedIn: this.signedIn,
      linkedProjectId: this.linkedProjectId,
      linkedProjectName: this.linkedProjectName,
    });
  }

  private async persistTranscript(): Promise<void> {
    await this.context.workspaceState.update(
      TRANSCRIPT_KEY,
      this.transcript.slice(-100_000),
    );
  }

  private async handleMessage(
    msg: NonNullable<ReturnType<MessageBridge['parseIncoming']>>,
  ): Promise<void> {
    switch (msg.type) {
      case 'READY':
        await this.refreshMcpConfigured();
        await this.refreshAuthAndLink();
        return;
      case 'SUBMIT_TASK':
        await this.startTask(msg.text, msg.mode === 'plan' ? 'plan' : 'full');
        return;
      case 'CANCEL':
        this.abort?.abort();
        this.host.resolveApproval(
          this.pendingApproval?.stepId ?? '',
          'reject',
        );
        this.pendingApproval = null;
        return;
      case 'APPROVE_STEP':
        this.host.resolveApproval(msg.stepId, 'approve');
        if (this.pendingApproval?.stepId === msg.stepId) {
          this.pendingApproval = null;
        }
        this.snapshot();
        return;
      case 'REJECT_STEP':
        this.host.resolveApproval(msg.stepId, 'reject');
        if (this.pendingApproval?.stepId === msg.stepId) {
          this.pendingApproval = null;
        }
        this.snapshot();
        return;
      case 'SET_AUTONOMY':
        this.host.setAutonomy(msg.level);
        await this.context.workspaceState.update(AUTONOMY_KEY, msg.level);
        this.snapshot();
        return;
      default:
        return;
    }
  }

  private async startTask(
    text: string,
    mode: 'ping' | 'full' | 'plan',
  ): Promise<void> {
    if (this.streaming) {
      this.bridge?.postError('A run is already in progress. Cancel it first.');
      return;
    }

    if (!this.host.isTrustedWorkspace()) {
      this.bridge?.postError(
        'Workspace is not trusted. Trust this folder to run the agent (NFR-D07).',
      );
      this.snapshot();
      return;
    }

    if (!this.host.getWorkspaceRoot() && mode !== 'ping') {
      this.bridge?.postError('Open a folder to run the agent on a workspace.');
      return;
    }

    this.streaming = true;
    this.pendingApproval = null;
    if (text.trim().toLowerCase() !== 'ping') {
      this.transcript = '';
      this.telemetry = {};
    }
    this.abort = new AbortController();
    this.host.setRunSignal(this.abort.signal);
    await this.refreshMcpConfigured();
    this.snapshot();

    const loopMode =
      text.trim().toLowerCase() === 'ping'
        ? 'ping'
        : mode === 'plan'
          ? 'plan'
          : 'full';

    const mcpConfig = await loadMcpConfigFromSecrets((k) =>
      Promise.resolve(this.context.secrets.get(k)),
    );
    const ccloudApiKey =
      (await this.context.secrets.get(SECRET_KEYS.ccloudApiKey)) ??
      mcpConfig?.apiKey;

    // Phase C: inject project memory only when signed in + linked.
    // Unlinked / local-only mode runs without projectMemory (Phase A/B).
    let projectMemory = undefined;
    const token = await this.auth.getAccessToken();
    if (token && this.linkedProjectId) {
      projectMemory = createProjectMemoryBridge({
        getToken: () => this.auth.getAccessToken(),
        projectId: this.linkedProjectId,
        projectName: this.linkedProjectName ?? undefined,
      });
    }

    try {
      await runAgentLoop({
        host: this.host,
        prompt: text,
        signal: this.abort.signal,
        mode: loopMode,
        subagentsEnabled: true,
        includePhaseB: true,
        mcpConfig,
        ccloudApiKey,
        projectMemory,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.bridge?.postError(message);
      this.streaming = false;
      this.host.setRunSignal(undefined);
    } finally {
      await this.persistTranscript();
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.css'),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>WalkCroach</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.abort?.abort();
    this.bridge?.dispose();
    this.output.dispose();
  }

  /** Called when workspace trust is granted so the panel unlocks without reload. */
  notifyTrustChanged(): void {
    this.snapshot();
  }
}

function getNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}
