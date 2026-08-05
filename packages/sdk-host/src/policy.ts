/**
 * Approval policy for a host with no human in the loop.
 *
 * ## Why auto-approval is defensible here, and only here
 *
 * The IDE host gates diffs and commands because the agent is running on *your
 * machine*, against *your* git history, with *your* credentials in the
 * environment. `rm -rf` there is unrecoverable and `curl | sh` there is a
 * compromise. That gate is correct and this does not weaken it — the IDE host
 * is untouched.
 *
 * A programmatic run is a different situation, not a relaxed version of the same
 * one. The workspace is a disposable sandbox we provisioned seconds ago; the
 * repository is a clone, not the origin; nothing is pushed without a pull
 * request. The two things per-step approval protects are not reachable, so
 * asking a human to approve each step would be ceremony rather than safety.
 *
 * **The containment is the sandbox. The review is the pull request.**
 *
 * ## What is still refused
 *
 * Auto-approval is not blanket approval. Three classes stay blocked even inside
 * a sandbox, because for each of them the sandbox is not the boundary:
 *
 *  - **Credential exfiltration.** Published research on managed agent sandboxes
 *    found network egress was not fully contained in the default mode. A command
 *    that reads instance metadata or posts a file to an unknown host is not made
 *    safe by running in a sandbox.
 *  - **Escaping the workspace.** Writes outside the workspace root reach the
 *    sandbox image, not the user's project, and nothing legitimate needs to.
 *  - **Infrastructure verbs.** `ccloud`, `terraform`, `aws`, MCP writes. These
 *    act on real infrastructure from inside the sandbox, so containment does not
 *    apply to them at all. The master doc puts them permanently outside
 *    auto-approve and that holds here.
 */

export type PolicyDecision =
  | { allow: true }
  | { allow: false; reason: string; rule: string };

/** Verbs that act on real infrastructure from inside a sandbox. */
const INFRA_COMMAND =
  /(^|[\s;&|(])(ccloud|terraform|aws|gcloud|az|kubectl|helm|eksctl|serverless|sls|cdk|pulumi)(\s|$)/i;

/** Reads of cloud instance metadata — the classic credential-theft first step. */
const METADATA_ENDPOINT =
  /(169\.254\.169\.254|metadata\.google\.internal|metadata\.azure\.com|\$\{?ECS_CONTAINER_METADATA|AWS_CONTAINER_CREDENTIALS)/i;

/** Piping a network fetch straight into a shell. */
const CURL_PIPE_SHELL =
  /\b(curl|wget|fetch)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|k|da)?sh\b/i;

/** Reads of well-known credential locations. */
const CREDENTIAL_PATH =
  /(~|\$HOME|\/root|\/home\/[^/\s]+)\/\.(aws|ssh|config\/gcloud|kube|docker|npmrc|netrc)\b|\/\.env(\.|$|\s)|id_rsa|id_ed25519/i;

/** Writes to system locations rather than the workspace. */
const SYSTEM_WRITE =
  /(^|[\s;&|])(sudo|su)\s|>\s*\/(etc|usr|bin|sbin|boot|sys|proc)\//i;

const RULES: Array<{ name: string; re: RegExp; why: string }> = [
  {
    name: 'infra-command',
    re: INFRA_COMMAND,
    why: 'acts on real infrastructure from inside the sandbox, so sandboxing is not containment for it',
  },
  {
    name: 'metadata-endpoint',
    re: METADATA_ENDPOINT,
    why: 'reads cloud instance metadata, the standard first step in credential theft',
  },
  {
    name: 'curl-pipe-shell',
    re: CURL_PIPE_SHELL,
    why: 'executes code fetched at runtime, which defeats any review of the diff',
  },
  {
    name: 'credential-path',
    re: CREDENTIAL_PATH,
    why: 'reads a well-known credential location',
  },
  {
    name: 'system-write',
    re: SYSTEM_WRITE,
    why: 'writes outside the workspace, into the sandbox image itself',
  },
];

export function evaluateCommand(cmd: string): PolicyDecision {
  for (const rule of RULES) {
    if (rule.re.test(cmd)) {
      return {
        allow: false,
        rule: rule.name,
        reason: `refused (${rule.name}): ${rule.why}`,
      };
    }
  }
  return { allow: true };
}

/**
 * Path containment.
 *
 * Normalised without touching the filesystem, because the filesystem being
 * checked is remote. `..` is resolved textually so `src/../../etc/passwd` is
 * caught before it is ever sent to the sandbox.
 */
export function evaluatePath(path: string, workspaceRoot: string): PolicyDecision {
  const normalise = (p: string): string => {
    const out: string[] = [];
    for (const part of p.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') out.pop();
      else out.push(part);
    }
    return (p.startsWith('/') ? '/' : '') + out.join('/');
  };

  const root = normalise(workspaceRoot);
  const target = path.startsWith('/')
    ? normalise(path)
    : normalise(`${workspaceRoot}/${path}`);

  if (target !== root && !target.startsWith(`${root}/`)) {
    return {
      allow: false,
      rule: 'path-escape',
      reason: `refused (path-escape): ${path} resolves outside the workspace root`,
    };
  }
  return { allow: true };
}

/** Thrown when the loop asks a question no automated run can answer. */
export class InputRequiredError extends Error {
  readonly code = 'INPUT_REQUIRED';
  constructor(
    readonly question: string,
    readonly options: string[],
  ) {
    super(
      `the agent asked for a decision this run cannot make: "${question}"` +
        (options.length ? ` (options: ${options.join(', ')})` : '') +
        '. Re-run with more specific instructions, or supply `answers` for this question.',
    );
    this.name = 'InputRequiredError';
  }
}
