import { describe, expect, it, vi, beforeEach } from 'vitest';
import { OutputSink, formatApprovalPreview, resolveOutputMode } from './output.js';

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
});

function afterEach(fn: () => void) {
  return globalThis.afterEach?.(fn) ?? void 0;
}
