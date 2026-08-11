import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  runAgentLoop,
  loadMcpConfigFromSecrets,
  loadMcpServersConfig,
  loadWorkspaceAgentConfig,
  describeConfiguredMcpServers,
  revokeStdioConsent,
  newSessionId,
  SECRET_KEYS,
  parseMcpConfigSnippet,
  DEFAULT_MCP_URL,
  normalizeLocalRepoKey,
  CONTINUE_PROMPT,
  revertTurn,
  normalizeBedrockApiKey,
  resolveInferenceCredentials,
  withInferenceCredentials,
  type AgentTodo,
  type BedrockMessage,
  type McpServerView,
  type PersistedChatTurn,
  type SubmitAttachment,
} from '@walkcroach/agent-engine';
import type { HostToWebviewMessage } from '@walkcroach/agent-engine';
import {
  AuthService,
  getCognitoConfig,
} from '../auth/session.js';
import {
  createProjectMemoryBridge,
  createSharedSkillsBridge,
  listMyProjects,
  createLink,
  deleteLink,
  listMemoryEntries,
  updateMemoryEntry,
  listSharedSkills,
  ideMe,
} from '../api/ideClient.js';
import { VsCodeHostAdapter } from './VsCodeHostAdapter';
import { MessageBridge } from './messageBridge';
import { LatencyTracker, formatLatencyReport } from './latency';

const execFileAsync = promisify(execFile);

const TRANSCRIPT_KEY = 'walkcroach.session.transcript';
const AUTONOMY_KEY = 'walkcroach.session.autonomy.v2';

/** Round/token caps — auto-resume with backoff instead of waiting for Continue. */
const AUTO_CONTINUE_REASONS = new Set([
  'max_iterations',
  'max_tokens',
  'incomplete',
  'unverified',
]);
// Intentionally excluded: stuck_tool_loop (identical failing tool retries)
const AUTO_CONTINUE_BASE_MS = 5_000;
const AUTO_CONTINUE_MAX_MS = 40_000;
const AUTO_CONTINUE_MAX_ATTEMPTS = 8;

type PendingApproval = Extract<
  HostToWebviewMessage,
  { type: 'APPROVAL_REQUEST' }
>;

export class WalkCroachSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'walkcroach.sidebar';

  private view?: vscode.WebviewView;
  private bridge?: MessageBridge;
  private webviewMessageSub?: vscode.Disposable;
  private abort?: AbortController;
  private transcript = '';
  private streaming = false;
  private pendingApproval: PendingApproval | null = null;
  private telemetry: Record<string, number> = {};
  private mcpConfigured = false;
  /** Configured MCP servers + live state, refreshed rather than computed inline
   *  because describing them touches the filesystem and SecretStorage. */
  private mcpServers: McpServerView[] = [];
  private bedrockConfigured = false;
  private ccloudConfigured = false;
  private signedIn = false;
  private linkedProjectId: string | null = null;
  private linkedProjectName: string | null = null;
  private linkId: string | undefined;
  private lastLoopMode: 'ping' | 'full' | 'plan' = 'full';
  /** Bedrock conversation for multi-turn Continue / follow-ups. */
  private sessionMessages: BedrockMessage[] = [];
  private sessionTodos: AgentTodo[] = [];
  /** Chat bubbles for reload (synced from webview). */
  private sessionUiTurns: PersistedChatTurn[] = [];
  /** Disk session id under .walkcroach/sessions/<id>/ */
  private sessionId: string | undefined;
  private sessionCreatedAt: string | undefined;
  /** Auto-continue after round/token limits (exponential backoff from 5s). */
  private autoContinueAttempt = 0;
  private autoContinueTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly auth: AuthService;
  private readonly output: vscode.OutputChannel;
  private readonly host: VsCodeHostAdapter;
  /** §7E — measures the PRD's latency budgets. Local only; never transmitted. */
  readonly latency = new LatencyTracker();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.auth = new AuthService(context.secrets);
    this.output = vscode.window.createOutputChannel('WalkCroach');
    this.transcript =
      context.workspaceState.get<string>(TRANSCRIPT_KEY) ?? '';
    const autonomy =
      context.workspaceState.get<'strict' | 'low_friction'>(AUTONOMY_KEY) ??
      'low_friction';

    this.host = new VsCodeHostAdapter((event) => {
      if (event.type === 'token_delta') {
        // NFR-D02: time to first streamed token. `stop` returns null once the
        // pending start is consumed, so only the first token of a task counts.
        this.latency.stop('firstToken');
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
          question: r.question,
          options: r.options,
          allowFreeText: r.allowFreeText,
        };
      }
      if (event.type === 'todos') {
        this.sessionTodos = event.todos;
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
        // Final completion (not auto-continue): close REPLs; leave background tasks.
        // Cancel / abort already killAll via setRunSignal listener.
        const willAutoContinue =
          event.type === 'done' &&
          event.canContinue &&
          AUTO_CONTINUE_REASONS.has(event.reason);
        if (event.type === 'done' && !willAutoContinue) {
          this.host.killInteractiveTerminalSessions?.();
        } else if (event.type === 'error') {
          this.host.killAllTerminals?.();
        }
        void this.persistTranscript();
        this.snapshot();
        if (willAutoContinue) {
          this.scheduleAutoContinue(event.reason);
        } else if (event.type === 'done' && !event.canContinue) {
          this.clearAutoContinue(true);
        }
      }
    }, this.output);

    this.host.bindSecrets(context.secrets);
    this.host.setAutonomy(autonomy);
    void this.refreshCredentialStatus();
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
      await this.refreshCredentialStatus();
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
        await this.refreshCredentialStatus();
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
    await this.refreshCredentialStatus();
    this.snapshot();
    void vscode.window.showInformationMessage(
      'CockroachDB credentials saved to SecretStorage.',
    );
  }

  async signInWithWeb(): Promise<void> {
    const cfg = getCognitoConfig();
    if (!cfg.webAppUrl) {
      void vscode.window.showInformationMessage(
        'WalkCroach Web URL is not configured. Set walkcroach.ide.webAppUrl, or use “WalkCroach: Paste Token”.',
      );
      return;
    }
    try {
      await this.auth.signInWithWeb({ webAppUrl: cfg.webAppUrl });
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
      await this.refreshAuthAndLink();
      void vscode.window.showInformationMessage('Signed in to WalkCroach.');
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
        description:
          p.kind === 'knowledge'
            ? 'Project'
            : p.kind === 'app'
              ? 'App Builder'
              : p.id,
        detail: p.id,
        project: p,
      })),
      { title: 'Link local repo to WalkCroach Project or App Builder workspace' },
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

  /**
   * View-only: shared skills sync across surfaces via CockroachDB.
   * Account-scoped (no linked project required), unlike viewMirroredMemory.
   */
  async viewSharedSkills(): Promise<void> {
    const token = await this.auth.getAccessToken();
    if (!token) {
      void vscode.window.showWarningMessage('Sign in first.');
      return;
    }

    let skills;
    try {
      skills = await listSharedSkills(token);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Failed to list skills: ${message}`);
      return;
    }

    if (!skills.length) {
      void vscode.window.showInformationMessage(
        'No shared skills yet. The agent saves one via the mirror_skill tool when you approve it.',
      );
      return;
    }

    const picked = await vscode.window.showQuickPick(
      skills.map((s) => ({
        label: s.name,
        description: s.sourceSurface,
        detail: s.description,
        skill: s,
      })),
      { title: 'Shared skills (select to view)' },
    );
    if (!picked) return;

    const doc = await vscode.workspace.openTextDocument({
      content: `# ${picked.skill.name}\n\n${picked.skill.description}\n\n---\n\n${picked.skill.body}`,
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    // NFR-D01: the panel counts as loaded when the webview reports READY.
    this.latency.start('panelLoad');
    this.view = webviewView;
    const { webview } = webviewView;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ],
    };

    this.bridge?.dispose();
    this.webviewMessageSub?.dispose();
    this.bridge = new MessageBridge((msg) => {
      void webview.postMessage(msg);
    });

    webview.html = this.getHtml(webview);

    this.webviewMessageSub = webview.onDidReceiveMessage((raw) => {
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
    if (!this.view || !this.bridge) {
      await vscode.commands.executeCommand('walkcroach.sidebar.focus');
      await this.waitForBridge();
    }
    await this.startTask('ping', 'ping');
  }

  /** Focus does not await resolveWebviewView — poll until the bridge exists. */
  private async waitForBridge(timeoutMs = 5_000): Promise<void> {
    if (this.bridge) return;
    const start = Date.now();
    while (!this.bridge) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          'WalkCroach sidebar did not become ready — open the WalkCroach view and try again.',
        );
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private async refreshCredentialStatus(): Promise<void> {
    const cfg = await loadMcpConfigFromSecrets((k) =>
      Promise.resolve(this.context.secrets.get(k)),
    );
    this.mcpConfigured = Boolean(cfg);
    // BYOK (Part 1 §4A / CLI §C4). One resolution rule, in the engine, for
    // both hosts. This used to be a second copy that checked only
    // `AWS_ACCESS_KEY_ID`, so a developer on `AWS_PROFILE` — the most common
    // setup — was told Bedrock was not configured while their runs worked
    // perfectly. Disagreeing with the CLI about the same machine is exactly
    // what "ships once in the engine" exists to prevent.
    const inference = await resolveInferenceCredentials(
      { get: (key) => Promise.resolve(this.context.secrets.get(key)) },
      { region: this.getBedrockRegionOverride() },
    );
    this.bedrockConfigured = inference.configured;
    const ccloud = await this.context.secrets.get(SECRET_KEYS.ccloudApiKey);
    this.ccloudConfigured = Boolean(ccloud?.trim() || cfg?.apiKey);
  }

  /**
   * Prefer the SecretStorage Bedrock key for this run (BYOK — Part 1 §4A).
   *
   * This was a private implementation here; it now delegates to the shared
   * engine helper so the IDE and the CLI resolve credentials the same way.
   * Two behaviour differences, both fixes: concurrent runs are serialised
   * (two panels could previously restore each other's environment), and a
   * pre-existing empty-string value is restored as empty rather than deleted.
   */
  private async withBedrockSecretEnv<T>(fn: () => Promise<T>): Promise<T> {
    return withInferenceCredentials(
      { get: (key) => Promise.resolve(this.context.secrets.get(key)) },
      fn,
    );
  }

  private async withBedrockRunOptions(): Promise<{
    modelId?: string;
    region?: string;
    reasoningEffort?: 'low' | 'medium' | 'high';
  }> {
    const modelOverride = this.getBedrockModelIdOverride();
    const regionOverride = this.getBedrockRegionOverride();
    const reasoningOverride = this.getReasoningEffortOverride();
    return {
      modelId: modelOverride || undefined,
      region: regionOverride || undefined,
      reasoningEffort: reasoningOverride || undefined,
    };
  }

  private getBedrockModelIdOverride(): string {
    const raw = vscode.workspace
      .getConfiguration('walkcroach.ide')
      .get<string>('bedrockModelId');
    return typeof raw === 'string' ? raw.trim() : '';
  }

  private getBedrockRegionOverride(): string {
    const raw = vscode.workspace
      .getConfiguration('walkcroach.ide')
      .get<string>('bedrockRegion');
    return typeof raw === 'string' ? raw.trim() : '';
  }

  /** Empty means "use the engine default" (medium). Legacy `off` is ignored. */
  private getReasoningEffortOverride(): '' | 'low' | 'medium' | 'high' {
    const raw = vscode.workspace
      .getConfiguration('walkcroach.ide')
      .get<string>('reasoningEffort');
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (v === 'low' || v === 'medium' || v === 'high') return v;
    return '';
  }

  /**
   * Session-scoped suppress of editor.formatOnSave for the agent run.
   * Reduces autosave/format races that false-trigger stale-read / edit mismatch.
   */
  private async beginFormatOnSaveSuppress(): Promise<() => Promise<void>> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const cfg = folder
      ? vscode.workspace.getConfiguration('editor', folder.uri)
      : vscode.workspace.getConfiguration('editor');
    const scope = folder
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : vscode.ConfigurationTarget.Workspace;
    const priorFormatOnSave = cfg.inspect<boolean>('formatOnSave');
    const priorMode = cfg.inspect<string>('formatOnSaveMode');
    const previousFormatOnSave = folder
      ? (priorFormatOnSave?.workspaceFolder ?? priorFormatOnSave?.workspace)
      : priorFormatOnSave?.workspace;
    const previousMode = folder
      ? (priorMode?.workspaceFolder ?? priorMode?.workspace)
      : priorMode?.workspace;
    try {
      await cfg.update('formatOnSave', false, scope);
    } catch (err) {
      this.output.appendLine(
        `formatOnSave suppress failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return async () => {};
    }
    return async () => {
      try {
        await cfg.update(
          'formatOnSave',
          previousFormatOnSave === undefined ? undefined : previousFormatOnSave,
          scope,
        );
        if (previousMode !== undefined) {
          await cfg.update('formatOnSaveMode', previousMode, scope);
        }
      } catch (err) {
        this.output.appendLine(
          `formatOnSave restore failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };
  }

  private async applySaveSettings(
    msg: Extract<
      NonNullable<ReturnType<MessageBridge['parseIncoming']>>,
      { type: 'SAVE_SETTINGS' }
    >,
  ): Promise<void> {
    try {
      if (msg.bedrockApiKey === null) {
        await this.context.secrets.delete(SECRET_KEYS.bedrockApiKey);
      } else if (msg.bedrockApiKey?.trim()) {
        await this.context.secrets.store(
          SECRET_KEYS.bedrockApiKey,
          normalizeBedrockApiKey(msg.bedrockApiKey),
        );
      }

      if (msg.bedrockRegion === null) {
        await vscode.workspace
          .getConfiguration('walkcroach.ide')
          .update('bedrockRegion', 'eu-west-2', vscode.ConfigurationTarget.Global);
      } else if (typeof msg.bedrockRegion === 'string' && msg.bedrockRegion.trim()) {
        await vscode.workspace
          .getConfiguration('walkcroach.ide')
          .update(
            'bedrockRegion',
            msg.bedrockRegion.trim(),
            vscode.ConfigurationTarget.Global,
          );
      }

      if (msg.bedrockModelId === null) {
        await vscode.workspace
          .getConfiguration('walkcroach.ide')
          .update('bedrockModelId', '', vscode.ConfigurationTarget.Global);
      } else if (typeof msg.bedrockModelId === 'string') {
        await vscode.workspace
          .getConfiguration('walkcroach.ide')
          .update(
            'bedrockModelId',
            msg.bedrockModelId.trim(),
            vscode.ConfigurationTarget.Global,
          );
      }

      if (msg.reasoningEffort === null || msg.reasoningEffort === 'off') {
        // Extended thinking is always on — clear override (including legacy "off").
        await vscode.workspace
          .getConfiguration('walkcroach.ide')
          .update('reasoningEffort', '', vscode.ConfigurationTarget.Global);
      } else if (typeof msg.reasoningEffort === 'string') {
        await vscode.workspace
          .getConfiguration('walkcroach.ide')
          .update(
            'reasoningEffort',
            msg.reasoningEffort,
            vscode.ConfigurationTarget.Global,
          );
      }

      if (msg.clearMcp) {
        for (const k of [
          SECRET_KEYS.mcpUrl,
          SECRET_KEYS.mcpClusterId,
          SECRET_KEYS.mcpApiKey,
          SECRET_KEYS.ccloudApiKey,
        ]) {
          await this.context.secrets.delete(k);
        }
      } else if (msg.mcpSnippet?.trim()) {
        const parsed = parseMcpConfigSnippet(msg.mcpSnippet);
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
      } else if (msg.mcpClusterId?.trim() && msg.mcpApiKey?.trim()) {
        await this.context.secrets.store(
          SECRET_KEYS.mcpClusterId,
          msg.mcpClusterId.trim(),
        );
        await this.context.secrets.store(
          SECRET_KEYS.mcpApiKey,
          msg.mcpApiKey.trim(),
        );
        await this.context.secrets.store(
          SECRET_KEYS.mcpUrl,
          msg.mcpUrl?.trim() || DEFAULT_MCP_URL,
        );
      }

      if (msg.ccloudApiKey === null) {
        await this.context.secrets.delete(SECRET_KEYS.ccloudApiKey);
      } else if (msg.ccloudApiKey?.trim()) {
        await this.context.secrets.store(
          SECRET_KEYS.ccloudApiKey,
          msg.ccloudApiKey.trim(),
        );
      }

      await this.refreshCredentialStatus();
      this.snapshot();
      void vscode.window.showInformationMessage(
        'WalkCroach credentials saved to SecretStorage.',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.bridge?.postError(message);
    }
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

  /**
   * Recompute the MCP server list shown in Setup.
   *
   * Reads config + consent + live supervisor state through the same engine
   * helper the CLI's `mcp list` uses, so the two surfaces cannot disagree about
   * what is approved.
   */
  private async refreshMcpServers(): Promise<void> {
    try {
      this.mcpServers = await describeConfiguredMcpServers({
        fileServers: await loadMcpServersConfig(this.host.getWorkspaceRoot()),
        secrets: this.host.secrets,
        allowStdio: this.host.isStdioMcpAllowed(),
        workspaceRoot: this.host.getWorkspaceRoot(),
        supervisor: this.host.stdioMcp,
      });
    } catch {
      // Setup must still render if the config is unreadable.
      this.mcpServers = [];
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
      mcpServers: this.mcpServers,
      mcpStdioAllowed: this.host.isStdioMcpAllowed(),
      bedrockConfigured: this.bedrockConfigured,
      bedrockModelId: this.getBedrockModelIdOverride(),
      bedrockRegion: this.getBedrockRegionOverride() || 'eu-west-2',
      reasoningEffort: this.getReasoningEffortOverride(),
      ccloudConfigured: this.ccloudConfigured,
      telemetry: this.telemetry,
      signedIn: this.signedIn,
      linkedProjectId: this.linkedProjectId,
      linkedProjectName: this.linkedProjectName,
      todos: this.sessionTodos,
      hasSession: this.sessionMessages.length > 0,
      uiTurns: this.sessionUiTurns,
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
        this.latency.stop('panelLoad');
        await this.refreshCredentialStatus();
        await this.refreshAuthAndLink();
        await this.refreshMcpServers();
        if (this.host.loadTodos) {
          const loaded = await this.host.loadTodos();
          if (loaded?.length) {
            this.sessionTodos = loaded;
          }
        }
        if (this.host.loadAgentSession) {
          try {
            const snap = await this.host.loadAgentSession();
            if (snap?.messages.length) {
              this.sessionId = snap.sessionId;
              this.sessionCreatedAt = snap.createdAt;
              this.sessionMessages = snap.messages;
              this.sessionUiTurns = snap.uiTurns ?? [];
              if (snap.transcript) {
                this.transcript = snap.transcript;
                await this.persistTranscript();
              }
            }
          } catch (err) {
            this.output.appendLine(
              `Session restore failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
        // Apply .walkcroach/settings.json autonomy only when user has no stored preference.
        if (
          this.context.workspaceState.get(AUTONOMY_KEY) === undefined
        ) {
          try {
            const cfg = await loadWorkspaceAgentConfig(
              this.host.getWorkspaceRoot(),
            );
            if (cfg.settings.autonomy) {
              this.host.setAutonomy(cfg.settings.autonomy);
            }
          } catch {
            /* ignore */
          }
        }
        this.snapshot();
        return;
      case 'SUBMIT_TASK':
        this.latency.start('firstToken');
        this.clearAutoContinue(true);
        // Only reset checklist on a true new chat; follow-ups keep prior todos.
        if (this.sessionMessages.length === 0) {
          await this.host.clearTodos?.();
          this.sessionTodos = [];
          this.bridge?.onAgentEvent({ type: 'todos', todos: [] });
        }
        await this.startTask(msg.text, msg.mode === 'plan' ? 'plan' : 'full', {
          attachments: msg.attachments,
        });
        return;
      case 'CANCEL':
        this.clearAutoContinue(true);
        this.abort?.abort();
        this.host.killAllTerminals?.();
        if (this.pendingApproval) {
          if (this.pendingApproval.kind === 'question') {
            this.host.resolveQuestion(
              this.pendingApproval.stepId,
              'reject',
            );
          } else {
            this.host.resolveApproval(
              this.pendingApproval.stepId,
              'reject',
            );
          }
          this.pendingApproval = null;
        }
        return;
      case 'APPROVE_STEP':
        this.host.resolveApproval(msg.stepId, 'approve');
        if (this.pendingApproval?.stepId === msg.stepId) {
          this.pendingApproval = null;
        }
        this.snapshot();
        return;
      case 'REJECT_STEP':
        if (this.pendingApproval?.kind === 'question') {
          this.host.resolveQuestion(msg.stepId, 'reject');
        } else {
          this.host.resolveApproval(msg.stepId, 'reject');
        }
        if (this.pendingApproval?.stepId === msg.stepId) {
          this.pendingApproval = null;
        }
        this.snapshot();
        return;
      case 'ANSWER_QUESTION':
        this.host.resolveQuestion(msg.stepId, {
          selected: msg.selected,
          freeText: msg.freeText,
        });
        if (this.pendingApproval?.stepId === msg.stepId) {
          this.pendingApproval = null;
        }
        this.snapshot();
        return;
      case 'CLEAR_SESSION':
        this.clearAutoContinue(true);
        this.sessionMessages = [];
        this.sessionTodos = [];
        this.sessionUiTurns = [];
        this.transcript = '';
        this.sessionId = undefined;
        this.sessionCreatedAt = undefined;
        await this.host.clearTodos?.();
        await this.host.clearAgentSession?.();
        await this.persistTranscript();
        this.snapshot();
        return;
      case 'SYNC_UI_TURNS':
        this.sessionUiTurns = msg.turns;
        if (this.sessionId && this.sessionMessages.length > 0) {
          void this.host
            .persistAgentSession?.({
              sessionId: this.sessionId,
              messages: this.sessionMessages,
              transcript: this.transcript,
              uiTurns: this.sessionUiTurns,
              createdAt: this.sessionCreatedAt,
            })
            .catch((err) => {
              this.output.appendLine(
                `UI turns persist failed: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            });
        }
        return;
      case 'CONTINUE_TASK':
        this.clearAutoContinue(false);
        await this.startTask(CONTINUE_PROMPT, this.lastLoopMode, {
          followUp: true,
        });
        return;
      case 'REVERT_TO_TURN': {
        const root = this.host.getWorkspaceRoot();
        if (!root) {
          this.bridge?.postError('Open a folder to revert changes.');
          return;
        }
        const decision = await this.host.confirmCommand(
          'Revert all file changes from this turn?',
          { toolName: 'revert_turn', stepId: msg.turnId },
        );
        if (decision !== 'approve') return;
        try {
          const { reverted } = await revertTurn(root, this.host, msg.turnId);
          if (reverted.length) {
            const summary = `Reverted ${reverted.length} file${
              reverted.length === 1 ? '' : 's'
            } from this turn: ${reverted.join(', ')}`;
            // this.transcript is not rendered by the webview (STATE_SNAPSHOT.transcript
            // is intentionally ignored there — see App.tsx) — it's kept only for
            // persistTranscript's session-restore bookkeeping. postWarning is the only
            // channel the webview actually surfaces, so use it for user-visible feedback.
            this.transcript += `${this.transcript ? '\n\n' : ''}${summary}`;
            await this.persistTranscript();
            this.bridge?.postWarning(summary);
          } else {
            this.bridge?.postWarning('Nothing to revert for this turn.');
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.bridge?.postError(`Revert failed: ${message}`);
        }
        this.snapshot();
        return;
      }
      case 'SET_AUTONOMY':
        this.host.setAutonomy(msg.level);
        await this.context.workspaceState.update(AUTONOMY_KEY, msg.level);
        this.snapshot();
        return;
      case 'SIGN_IN':
        await this.signInWithWeb();
        return;
      case 'STOP_MCP_SERVER': {
        const stopped = await this.host.stdioMcp.stop(msg.name);
        this.bridge?.postWarning(
          stopped
            ? `Stopped MCP server "${msg.name}".`
            : `MCP server "${msg.name}" was not running.`,
        );
        await this.refreshMcpServers();
        this.snapshot();
        return;
      }
      case 'REVOKE_MCP_CONSENT': {
        const revoked = await revokeStdioConsent(this.host.secrets, msg.name);
        // Revoking does not kill anything already running — that is `stop`.
        // Saying so avoids the impression the process was also terminated.
        this.bridge?.postWarning(
          revoked === 0
            ? 'No matching approvals were recorded.'
            : `Revoked ${revoked} approval${revoked === 1 ? '' : 's'}. You will be asked again on the next run. Already-running servers keep running until stopped.`,
        );
        await this.refreshMcpServers();
        this.snapshot();
        return;
      }
      case 'SAVE_SETTINGS':
        await this.applySaveSettings(msg);
        return;
      default:
        return;
    }
  }

  private async startTask(
    text: string,
    mode: 'ping' | 'full' | 'plan',
    opts?: { followUp?: boolean; attachments?: SubmitAttachment[] },
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
      this.bridge?.postError(
        'Open Folder (workspace root) before running the agent.',
      );
      return;
    }

    this.streaming = true;
    this.pendingApproval = null;
    this.lastLoopMode = mode;
    const isContinue = text === CONTINUE_PROMPT || opts?.followUp === true;
    const hasSession = this.sessionMessages.length > 0;
    if (text.trim().toLowerCase() !== 'ping' && !isContinue) {
      // New user message: keep session messages for continuity; only reset
      // host transcript buffer used for debug persistence.
      this.transcript = '';
      this.telemetry = {};
    }
    if (isContinue) {
      this.transcript += this.transcript ? '\n\n' : '';
    }
    this.abort = new AbortController();
    this.host.setRunSignal(this.abort.signal);
    await this.refreshCredentialStatus();
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

    let projectMemory = undefined;
    let sharedSkills = undefined;
    const token = await this.auth.getAccessToken();
    if (token && this.linkedProjectId) {
      projectMemory = createProjectMemoryBridge({
        getToken: () => this.auth.getAccessToken(),
        projectId: this.linkedProjectId,
        projectName: this.linkedProjectName ?? undefined,
      });
    }
    if (token) {
      sharedSkills = createSharedSkillsBridge({
        getToken: () => this.auth.getAccessToken(),
        sourceSurface: 'ide',
      });
    }

    const formatRestore = await this.beginFormatOnSaveSuppress();
    try {
      const bedrockOpts = await this.withBedrockRunOptions();
      await this.withBedrockSecretEnv(async () => {
        await runAgentLoop({
          host: this.host,
          prompt: text,
          signal: this.abort!.signal,
          mode: loopMode,
          // Agent (full) always treats as action; Ask (plan) never.
          actionBias: loopMode === 'plan' ? 'never' : 'always',
          subagentsEnabled: true,
          includePhaseB: true,
          mcpConfig,
          ccloudApiKey,
          projectMemory,
          sharedSkills,
          modelId: bedrockOpts.modelId,
          region: bedrockOpts.region,
          reasoningEffort: bedrockOpts.reasoningEffort,
          officialSkillsJsonPath: path.join(
            this.context.extensionPath,
            'dist',
            'cockroachdb-official.generated.json',
          ),
          priorMessages: hasSession ? this.sessionMessages : undefined,
          followUp: isContinue || hasSession,
          attachments: opts?.attachments,
          onSessionMessages: (messages) => {
            this.sessionMessages = messages;
            if (!this.sessionId) {
              this.sessionId = newSessionId();
              this.sessionCreatedAt = new Date().toISOString();
            }
            const sessionId = this.sessionId;
            const createdAt = this.sessionCreatedAt;
            const transcript = this.transcript;
            const uiTurns = this.sessionUiTurns;
            void this.host
              .persistAgentSession?.({
                sessionId,
                messages,
                transcript,
                uiTurns,
                createdAt,
              })
              .catch((err) => {
                this.output.appendLine(
                  `Session persist failed: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                );
              });
          },
        });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.bridge?.postError(message);
      this.streaming = false;
      this.host.setRunSignal(undefined);
    } finally {
      await formatRestore();
      await this.persistTranscript();
    }
  }

  private clearAutoContinue(resetAttempts: boolean): void {
    if (this.autoContinueTimer) {
      clearTimeout(this.autoContinueTimer);
      this.autoContinueTimer = undefined;
    }
    if (resetAttempts) this.autoContinueAttempt = 0;
  }

  private scheduleAutoContinue(reason: string): void {
    if (this.autoContinueAttempt >= AUTO_CONTINUE_MAX_ATTEMPTS) {
      this.bridge?.postWarning(
        `Stopped auto-continue after ${AUTO_CONTINUE_MAX_ATTEMPTS} rounds (${reason}). Click Continue if work remains.`,
      );
      this.clearAutoContinue(true);
      return;
    }
    const delay = Math.min(
      AUTO_CONTINUE_BASE_MS * 2 ** this.autoContinueAttempt,
      AUTO_CONTINUE_MAX_MS,
    );
    this.autoContinueAttempt += 1;
    const attempt = this.autoContinueAttempt;
    this.bridge?.postWarning(
      `Round limit (${reason}) — continuing in ${Math.round(delay / 1000)}s (attempt ${attempt}/${AUTO_CONTINUE_MAX_ATTEMPTS})…`,
    );
    this.clearAutoContinue(false);
    this.autoContinueTimer = setTimeout(() => {
      this.autoContinueTimer = undefined;
      void this.startTask(CONTINUE_PROMPT, this.lastLoopMode, {
        followUp: true,
      });
    }, delay);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.css'),
    );
    const markUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'walkcroach-mark.png'),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; font-src ${webview.cspSource} https://fonts.gstatic.com; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Sora:wght@500;600;700&family=Source+Sans+3:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>WalkCroach</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    window.__WALKCROACH_MARK__ = ${JSON.stringify(markUri.toString())};
    window.addEventListener('error', function (e) {
      var el = document.getElementById('root');
      if (el) el.textContent = 'WalkCroach UI failed to load: ' + (e.message || e);
    });
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.clearAutoContinue(true);
    this.abort?.abort();
    // After a clean done, abort is already cleared — still reap leftover shells.
    this.host.killAllTerminals?.();
    // §6.6 — stdio MCP servers are tied to window lifetime, not to a run. A
    // server left alive after the window closes is indistinguishable from a
    // legitimate long-running process, which is threat T6.
    void this.host.stdioMcp.disposeAll();
    this.webviewMessageSub?.dispose();
    this.webviewMessageSub = undefined;
    this.bridge?.dispose();
    this.bridge = undefined;
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

/** §7E — human-readable latency report for the output channel. */
export function renderLatencyReport(provider: { latency: LatencyTracker }): string {
  return formatLatencyReport(provider.latency.reportAll());
}
