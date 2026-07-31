import { describe, expect, it, vi, beforeEach } from 'vitest';
import { OutputSink, formatApprovalPreview, resolveOutputMode } from './output.js';
import { AuthRequiredError } from './exit-codes.js';

describe('OutputSink — json mode', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('writes event as JSON line', () => {
    const sink = new OutputSink('json');
    sink.event({ type: 'phase', phase: 'gather' });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const line = (writeSpy.mock.calls[0]![0] as string).trim();
    const parsed = JSON.parse(line);
    expect(parsed.type).toBe('event');
    expect(parsed.event.type).toBe('phase');
  });

  it('writes result as JSON line', () => {
    const sink = new OutputSink('json');
    sink.result(true);
    const line = (writeSpy.mock.calls[0]![0] as string).trim();
    expect(JSON.parse(line)).toEqual({ type: 'result', ok: true });
  });

  it('writes command as JSON line', () => {
    const sink = new OutputSink('json');
    sink.command('test', { foo: 'bar' });
    const line = (writeSpy.mock.calls[0]![0] as string).trim();
    expect(JSON.parse(line).type).toBe('command');
  });
});

describe('OutputSink — text mode', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('writes token_delta to stdout', () => {
    const sink = new OutputSink('text');
    sink.event({ type: 'token_delta', text: 'hello' });
    expect(stdoutSpy).toHaveBeenCalledWith('hello');
  });

  it('writes phase to stderr', () => {
    const sink = new OutputSink('text');
    sink.event({ type: 'phase', phase: 'gather' });
    expect(stderrSpy).toHaveBeenCalled();
    const out = stderrSpy.mock.calls[0]![0] as string;
    expect(out).toContain('gather');
  });

  it('writes tool_card to stderr', () => {
    const sink = new OutputSink('text');
    sink.event({
      type: 'tool_card',
      id: 't1',
      name: 'read_file',
      status: 'done',
      detail: 'src/a.ts',
    });
    expect(stderrSpy).toHaveBeenCalled();
    const out = stderrSpy.mock.calls[0]![0] as string;
    expect(out).toContain('read_file');
  });

  it('writes error result to stderr', () => {
    const sink = new OutputSink('text');
    sink.result(false, { error: 'boom' });
    expect(stderrSpy).toHaveBeenCalledWith('boom\n');
  });

  it('writes string data in command to stdout', () => {
    const sink = new OutputSink('text');
    sink.command('test', 'hello world');
    expect(stdoutSpy).toHaveBeenCalledWith('hello world\n');
  });

  it('writes object data in command as pretty JSON', () => {
    const sink = new OutputSink('text');
    sink.command('test', { k: 'v' });
    const out = stdoutSpy.mock.calls[0]![0] as string;
    expect(JSON.parse(out)).toEqual({ k: 'v' });
  });

  it('writes done to stderr', () => {
    const sink = new OutputSink('text');
    sink.event({ type: 'done', reason: 'complete' });
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('writes error event to stderr', () => {
    const sink = new OutputSink('text');
    sink.event({ type: 'error', message: 'fatal', fatal: true });
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('ignores telemetry in text mode', () => {
    const sink = new OutputSink('text');
    sink.event({ type: 'telemetry', name: 'mcp_call', counters: {} as any });
    expect(stderrSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});

describe('formatApprovalPreview', () => {
  it('formats diff approval', () => {
    const text = formatApprovalPreview({
      stepId: 's1',
      kind: 'diff',
      toolName: 'edit_file',
      path: 'src/a.ts',
      before: 'old code',
      after: 'new code',
    });
    expect(text).toContain('edit_file');
    expect(text).toContain('src/a.ts');
    expect(text).toContain('old code');
    expect(text).toContain('new code');
  });

  it('formats command approval', () => {
    const text = formatApprovalPreview({
      stepId: 's2',
      kind: 'command',
      toolName: 'run_terminal',
      cmd: 'npm test',
    });
    expect(text).toContain('run_terminal');
    expect(text).toContain('npm test');
  });
});

describe('resolveOutputMode', () => {
  it('json takes priority', () => {
    expect(resolveOutputMode({ json: true })).toBe('json');
  });

  it('noTui forces text', () => {
    expect(resolveOutputMode({ noTui: true })).toBe('text');
  });

  it('forceTui returns tui', () => {
    expect(resolveOutputMode({ forceTui: true })).toBe('tui');
  });

  it('drops to text on a dumb terminal, which cannot render the TUI', () => {
    expect(resolveOutputMode({}, { TERM: 'dumb' })).toBe('text');
  });
});

/**
 * The redaction boundary (C0.7). Both halves matter: scrubbing the wrong
 * stream is as much a defect as not scrubbing at all.
 */
describe('OutputSink — redaction boundary', () => {
  const JWT =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.7hK2n-QlPzYyU1sGdN4pR8vXcMkLtBq0aWfEjIoZuHs';

  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it('scrubs a token out of a command payload', () => {
    new OutputSink('json').command('auth.status', {
      signedIn: true,
      accessToken: JWT,
    });
    const line = String(stdout.mock.calls[0]![0]);
    expect(line).not.toContain(JWT);
    expect(line).toContain('"signedIn":true');
  });

  it('scrubs a token out of an error, in both json and text mode', () => {
    new OutputSink('json').result(false, { error: `bad token ${JWT}` });
    expect(String(stdout.mock.calls[0]![0])).not.toContain(JWT);

    new OutputSink('text').result(false, { error: `bad token ${JWT}` });
    expect(String(stderr.mock.calls[0]![0])).not.toContain(JWT);
  });

  it('scrubs an error event', () => {
    new OutputSink('text').event({
      type: 'error',
      message: `request failed with Authorization: Bearer ${JWT}`,
    });
    expect(String(stderr.mock.calls[0]![0])).not.toContain(JWT);
  });

  it('leaves the agent token stream byte-for-byte intact', () => {
    // An approval card and a code diff are the user's own content shown back
    // to them. Redacting here would corrupt generated code and undermine the
    // one thing that makes the approval gate meaningful — so the guard stops
    // at the CLI's own output.
    const generated = 'const key = "AKIAIOSFODNN7EXAMPLE"; // sample only';
    new OutputSink('text').event({ type: 'token_delta', text: generated });
    expect(String(stdout.mock.calls[0]![0])).toBe(generated);
  });
});

function afterEach(fn: () => void) {
  return globalThis.afterEach?.(fn) ?? void 0;
}


/** Structured failures on the JSON envelope (C5.5). */
describe('OutputSink — structured failures', () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it('adds code and hint without removing the error string', () => {
    // Additive: a script already reading `.error` must keep working (P8).
    new OutputSink('json').failure(new AuthRequiredError());
    const payload = JSON.parse(String(stdout.mock.calls[0]![0]));
    expect(payload).toMatchObject({
      type: 'result',
      ok: false,
      code: 'auth_required',
    });
    expect(typeof payload.error).toBe('string');
    expect(payload.hint).toContain('walkcroach auth login');
  });

  it('prints the hint on its own line in human mode', () => {
    new OutputSink('text').result(false, {
      error: 'Something went wrong',
      code: 'network',
      hint: 'Retry shortly.',
    });
    const written = stderr.mock.calls.map((c) => String(c[0]).trimEnd());
    expect(written).toEqual(['Something went wrong', 'Retry shortly.']);
  });

  it('does not repeat a hint the message already gives', () => {
    // AuthRequiredError names the fix in its own text; printing the hint too
    // said "Run: walkcroach auth login" twice, at exactly the moment someone
    // is reading a failure.
    new OutputSink('text').failure(new AuthRequiredError());
    expect(stderr.mock.calls.map(String)).toHaveLength(1);
  });

  it('still carries the hint in JSON even when the prose repeats it', () => {
    // A script wants the field regardless of how the human text reads.
    new OutputSink('json').failure(new AuthRequiredError());
    expect(JSON.parse(String(stdout.mock.calls[0]![0])).hint).toBeTruthy();
  });

  it('scrubs a credential out of a hint as well as a message', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig';
    new OutputSink('text').result(false, {
      error: 'failed',
      code: 'unknown',
      hint: `retry with ${jwt}`,
    });
    expect(stderr.mock.calls.map(String).join('')).not.toContain(jwt);
  });
});
