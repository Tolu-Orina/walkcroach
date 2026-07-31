/**
 * Process-wide flags parsed once from the global options (C0.6).
 *
 * These live outside the config file on purpose: they describe *this
 * invocation*, not the user's preferences, so persisting them would be wrong.
 * Commander sets them in a `preAction` hook before any command body runs.
 */
export type RuntimeFlags = {
  /** `--api-url`, the highest-precedence source for the API base (C0.2). */
  apiBaseUrl?: string;
  /** `--no-color`. */
  noColor: boolean;
  /** `--no-input`: never prompt, even on a TTY. */
  noInput: boolean;
};

const DEFAULTS: RuntimeFlags = { noColor: false, noInput: false };

let flags: RuntimeFlags = { ...DEFAULTS };

export function setRuntimeFlags(patch: Partial<RuntimeFlags>): void {
  flags = { ...flags, ...patch };
}

export function getRuntimeFlags(): Readonly<RuntimeFlags> {
  return flags;
}

/** Tests only — the module holds process state, so it must be resettable. */
export function resetRuntimeFlags(): void {
  flags = { ...DEFAULTS };
}

type ColourStream = { isTTY?: boolean };

/**
 * Whether to emit ANSI colour on a stream.
 *
 * Order matters. An explicit `--no-color` or `NO_COLOR` beats `FORCE_COLOR`,
 * because the person typing the flag is more current than the environment they
 * inherited. Everything else follows the conventions clig.dev codifies: no
 * colour when the stream is not a terminal, and none under `TERM=dumb`.
 */
export function colorEnabled(
  stream: ColourStream = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (flags.noColor) return false;
  // no-color.org: any value, including the empty string, means "disable".
  if (env.NO_COLOR !== undefined) return false;
  const force = env.FORCE_COLOR;
  if (force !== undefined && force !== '' && force !== '0') return true;
  if (env.TERM === 'dumb') return false;
  return Boolean(stream.isTTY);
}

/**
 * Whether the CLI may prompt.
 *
 * clig.dev: only use interactive elements when stdin is a TTY, and never when
 * `--no-input` is passed. Every caller must have a flag-based path to the same
 * outcome — a prompt is an affordance, never the only way through.
 */
export function inputAllowed(
  stdin: ColourStream = process.stdin,
): boolean {
  if (flags.noInput) return false;
  return Boolean(stdin.isTTY);
}
