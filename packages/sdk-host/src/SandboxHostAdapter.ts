/**
 * `SandboxHostAdapter` — WalkCroach IDE, running programmatically.
 *
 * `@walkcroach/agent-engine` is host-agnostic by construction: it must never
 * import `vscode`, and everything environment-specific goes through
 * `HostAdapter`. VS Code implements it against the editor; the CLI implements it
 * against a local shell. This implements it against a **sandbox**, which is what
 * makes the agent loop drivable from an API call instead of a keyboard.
 *
 * Nothing about the loop changes. Same gather → act → verify, same Phase A/B/C
 * tools, same skills, hooks, checkpoints, todos, subagents, tool-loop guard.
 * The only thing that differs is where files live and who answers the questions.
 *
 * Three behaviours are genuinely different from the interactive hosts, and each
 * is a deliberate decision rather than a gap:
 *
 *  1. **Approvals resolve by policy, not by a person** — see `policy.ts`. The
 *     sandbox is the containment and the pull request is the review.
 *  2. **`askUser` fails the run.** An agent that invents an answer to "which of
 *     these two layouts?" and proceeds is worse than one that stops and says it
 *     needed input.
 *  3. **stdio MCP is refused outright.** `isStdioMcpAllowed` returns false and
 *     cannot be configured to return true, matching the deferred stdio posture.
 */
import type {
  AgentEvent,
  ApprovalDecision,
  HostAdapter,
  HostSecrets,
  RunTerminalOpts,
  SearchHit,
  TerminalChunk,
  UserQuestionAnswer,
} from '@walkcroach/agent-engine';
import type { AutonomyLevel } from '@walkcroach/agent-engine';
import { evaluateCommand, evaluatePath, InputRequiredError } from './policy.js';
import type { SandboxLike } from './sandbox-contract.js';
import {
  describeScope,
  evaluateDelete,
  evaluateWrite,
  type WriteScope,
} from './write-scope.js';

export type SandboxHostOptions = {
  sandbox: SandboxLike;
  /**
   * **Required.** What this run may change. There is deliberately no default —
   * see `write-scope.ts`. Publishing into a customer's repo is `additive`;
   * the App Builder, which owns its workspace, is `full`.
   */
  writeScope: WriteScope;
  workspaceRoot?: string;
  /** Where emitted events go — SSE stream, buffer, logger. */
  onEvent?: (event: AgentEvent) => void;
  secrets?: HostSecrets;
  /**
   * Pre-supplied answers for `ask_user`, keyed by an exact question match.
   * Lets a caller answer a question it can anticipate without a human, while
   * anything unanticipated still fails loudly rather than being guessed.
   */
  answers?: Record<string, string>;
};

const IN_MEMORY_SECRETS = (): HostSecrets => {
  const store = new Map<string, string>();
  return {
    get: async (k) => store.get(k),
    store: async (k, v) => void store.set(k, v),
  };
};

export class SandboxHostAdapter implements HostAdapter {
  readonly secrets: HostSecrets;
  private readonly sandbox: SandboxLike;
  private readonly root: string;
  private readonly onEvent: (event: AgentEvent) => void;
  private readonly answers: Record<string, string>;

  /**
   * `strict`, deliberately — and this is load-bearing, not caution.
   *
   * At `low_friction` the engine's `shouldAutoApprove` returns true for any
   * shell command its own `isCriticalCommand` does not match, and `confirmCommand`
   * is then never called. That regex covers `sudo`, `rm -rf`, and `curl | sh`,
   * but not the two risks that are specific to running inside a cloud sandbox:
   * reads of the instance metadata endpoint, and reads of `~/.aws` or `~/.ssh`.
   * Those would auto-approve without ever reaching `policy.ts`.
   *
   * `strict` routes every command through `confirmCommand`, where the policy
   * runs. Since the policy then auto-approves anything it considers safe, this
   * costs nothing in round-trips — a programmatic run never waits on a human
   * either way — and closes the bypass.
   */
  private autonomy: AutonomyLevel = 'strict';

  /** Policy refusals, surfaced on the run result so a caller can see them. */
  readonly refusals: Array<{ rule: string; reason: string; subject: string }> = [];

  private readonly writeScope: WriteScope;
  /** Files this run created — always editable, in every mode. */
  private readonly createdInRun = new Set<string>();
  /** Existence checks are a sandbox round trip; memoised per run. */
  private readonly existenceCache = new Map<string, boolean>();

  constructor(opts: SandboxHostOptions) {
    this.sandbox = opts.sandbox;
    this.writeScope = opts.writeScope;
    this.root = (opts.workspaceRoot ?? '/workspace').replace(/\/+$/, '');
    this.onEvent = opts.onEvent ?? (() => {});
    this.secrets = opts.secrets ?? IN_MEMORY_SECRETS();
    this.answers = opts.answers ?? {};
  }

  /** Instruction text for the system prompt, so the model knows the rule up front. */
  describeWriteScope(): string {
    return describeScope(this.writeScope);
  }

  /** Workspace-relative paths this run created or modified. */
  writtenPaths(): string[] {
    const prefix = `${this.root}/`;
    return [...this.createdInRun]
      .map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p))
      .sort();
  }

  private async exists(absPath: string): Promise<boolean> {
    const cached = this.existenceCache.get(absPath);
    if (cached !== undefined) return cached;
    let present: boolean;
    try {
      await this.sandbox.readFile(absPath);
      present = true;
    } catch {
      present = false;
    }
    this.existenceCache.set(absPath, present);
    return present;
  }

  // ── filesystem ──────────────────────────────────────────────────────────

  private assertInWorkspace(path: string): void {
    const decision = evaluatePath(path, this.root);
    if (!decision.allow) {
      this.refusals.push({ rule: decision.rule, reason: decision.reason, subject: path });
      throw new Error(decision.reason);
    }
  }

  private abs(path: string): string {
    return path.startsWith('/') ? path : `${this.root}/${path}`;
  }

  async readFile(path: string): Promise<string> {
    this.assertInWorkspace(path);
    return this.sandbox.readFile(this.abs(path));
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.assertInWorkspace(path);
    const abs = this.abs(path);

    const decision = evaluateWrite({
      scope: this.writeScope,
      path,
      preExisting: await this.exists(abs),
      createdInRun: this.createdInRun.has(abs),
    });
    if (!decision.allow) {
      this.refusals.push({ rule: decision.rule, reason: decision.reason, subject: path });
      throw new Error(decision.reason);
    }

    await this.sandbox.writeFile(abs, content);
    this.createdInRun.add(abs);
    // It exists now, so a later scope check must not treat it as new.
    this.existenceCache.set(abs, true);
  }

  async deleteFile(path: string): Promise<void> {
    this.assertInWorkspace(path);
    const abs = this.abs(path);

    const decision = evaluateDelete({
      scope: this.writeScope,
      path,
      createdInRun: this.createdInRun.has(abs),
    });
    if (!decision.allow) {
      this.refusals.push({ rule: decision.rule, reason: decision.reason, subject: path });
      throw new Error(decision.reason);
    }

    // Single-quoted and escaped: a path is attacker-influenced input the moment
    // the model chooses it.
    await this.sandbox.runTerminal(`rm -f '${abs.replace(/'/g, `'\\''`)}'`);
    this.createdInRun.delete(abs);
    this.existenceCache.set(abs, false);
  }

  async listDir(path: string): Promise<string[]> {
    this.assertInWorkspace(path);
    return this.sandbox.listFiles(this.abs(path));
  }

  async glob(pattern: string): Promise<string[]> {
    const res = await this.sandbox.runTerminal(
      `find . -type f -path './${pattern.replace(/'/g, '')}' -not -path '*/node_modules/*' | head -500`,
      { cwd: this.root },
    );
    return res.stdout.split('\n').map((l) => l.replace(/^\.\//, '').trim()).filter(Boolean);
  }

  async search(pattern: string, opts?: { glob?: string }): Promise<SearchHit[]> {
    const include = opts?.glob ? `--include='${opts.glob.replace(/'/g, '')}'` : '';
    // -F: the pattern is a literal, not a regex the model can use to hang grep.
    const res = await this.sandbox.runTerminal(
      `grep -rnF ${include} --exclude-dir=node_modules --exclude-dir=.git -- '${pattern.replace(/'/g, '')}' . | head -200`,
      { cwd: this.root },
    );
    const hits: SearchHit[] = [];
    for (const line of res.stdout.split('\n')) {
      const m = /^\.?\/?([^:]+):(\d+):(.*)$/.exec(line);
      if (m) hits.push({ path: m[1]!, line: Number(m[2]), text: m[3]! });
    }
    return hits;
  }

  // ── terminal ────────────────────────────────────────────────────────────

  async *runTerminal(cmd: string, opts: RunTerminalOpts): AsyncIterable<TerminalChunk> {
    const decision = evaluateCommand(cmd);
    if (!decision.allow) {
      this.refusals.push({ rule: decision.rule, reason: decision.reason, subject: cmd });
      // Surfaced as terminal output with a non-zero exit rather than thrown, so
      // the model reads the refusal and adapts instead of the run dying.
      yield { stream: 'stderr', text: `${decision.reason}\n`, exitCode: 126 };
      return;
    }

    const res = await this.sandbox.runTerminal(cmd, { cwd: opts.cwd || this.root });
    if (res.stdout) yield { stream: 'stdout', text: res.stdout };
    if (res.stderr) yield { stream: 'stderr', text: res.stderr };
    yield { stream: 'stdout', text: '', exitCode: res.exitCode };
  }

  // ── approvals: resolved by policy, never by a person ─────────────────────

  async showDiffPreview(): Promise<ApprovalDecision> {
    // Path containment already ran in writeFile. A diff inside a disposable
    // workspace that reaches a human as a pull request needs no second gate.
    return 'approve';
  }

  async confirmCommand(cmd: string): Promise<ApprovalDecision> {
    return evaluateCommand(cmd).allow ? 'approve' : 'reject';
  }

  /**
   * Set when the loop asked something this run cannot answer.
   *
   * Recorded rather than only thrown, because `runAgentLoop` catches every
   * non-abort error and emits `done` instead of rethrowing — an exception from
   * here never reaches the caller. Relying on propagation made the
   * `input_required` outcome unreachable in practice.
   */
  inputRequired: { question: string; options: string[] } | null = null;

  async askUser(params: {
    question: string;
    options: string[];
    allowFreeText?: boolean;
  }): Promise<UserQuestionAnswer> {
    const supplied =
      this.answers[params.question] ?? this.answers['*'];
    if (supplied !== undefined) return { selected: supplied };

    this.inputRequired ??= { question: params.question, options: params.options };
    // Still thrown so the loop stops rather than proceeding on a guess.
    throw new InputRequiredError(params.question, params.options);
  }

  // No-ops: nothing is ever pending, because nothing ever waits on a human.
  resolveApproval(): void {}
  resolveQuestion(): void {}

  getAutonomy(): AutonomyLevel {
    return this.autonomy;
  }

  /**
   * Accepted but ignored for anything below `strict`.
   *
   * The loop may lower autonomy for its own reasons; a programmatic host must
   * not let it, because lowering it here re-opens the `shouldAutoApprove`
   * bypass documented above. Raising a refusal into the event stream keeps the
   * decision visible rather than silently disregarded.
   */
  setAutonomy(level: AutonomyLevel): void {
    if (level === 'strict') {
      this.autonomy = level;
      return;
    }
    this.onEvent({
      type: 'warning',
      message:
        `ignored setAutonomy('${level}'): a programmatic run stays strict so every ` +
        'command is policy-checked rather than auto-approved by the engine.',
    });
  }

  // ── workspace ───────────────────────────────────────────────────────────

  getWorkspaceRoot(): string | undefined {
    return this.root;
  }

  /** We provisioned this sandbox seconds ago; there is no third party to trust. */
  isTrustedWorkspace(): boolean {
    return true;
  }

  /**
   * Hard false, and deliberately not configurable.
   *
   * `isTrustedWorkspace` is true because we created the sandbox — but that says
   * nothing about the repository cloned into it, which is exactly the untrusted
   * input here. A `.walkcroach/mcp.json` arriving with a customer's repo must
   * never be able to spawn a process.
   */
  isStdioMcpAllowed(): boolean {
    return false;
  }

  emit(event: AgentEvent): void {
    this.onEvent(event);
  }
}
