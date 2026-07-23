import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { HostToWebviewMessage } from '@walkcroach/agent-engine';
import { MessageBridge } from './messageBridge.js';

describe('MessageBridge', () => {
  let posted: HostToWebviewMessage[];
  let bridge: MessageBridge;

  beforeEach(() => {
    vi.useFakeTimers();
    posted = [];
    bridge = new MessageBridge((msg) => posted.push(msg));
  });

  afterEach(() => {
    bridge.dispose();
    vi.useRealTimers();
  });

  it('coalesces token_delta events', async () => {
    bridge.onAgentEvent({ type: 'token_delta', text: 'a' });
    bridge.onAgentEvent({ type: 'token_delta', text: 'b' });
    bridge.onAgentEvent({ type: 'token_delta', text: 'c' });
    expect(posted).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(20);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.type).toBe('TOKEN_DELTA');
    expect((posted[0] as any).text).toBe('abc');
  });

  it('flushes before phase events', () => {
    bridge.onAgentEvent({ type: 'token_delta', text: 'x' });
    bridge.onAgentEvent({ type: 'phase', phase: 'act' });
    expect(posted).toHaveLength(2);
    expect(posted[0]!.type).toBe('TOKEN_DELTA');
    expect(posted[1]!.type).toBe('PHASE');
  });

  it('maps tool_card events', () => {
    bridge.onAgentEvent({
      type: 'tool_card',
      id: 't1',
      name: 'read_file',
      status: 'running',
      detail: 'src/a.ts',
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]!.type).toBe('TOOL_CARD');
    expect((posted[0] as any).name).toBe('read_file');
  });

  it('maps approval_request events', () => {
    bridge.onAgentEvent({
      type: 'approval_request',
      request: {
        stepId: 's1',
        kind: 'diff',
        toolName: 'edit_file',
        path: 'a.ts',
        before: 'old',
        after: 'new',
      },
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]!.type).toBe('APPROVAL_REQUEST');
    expect((posted[0] as any).stepId).toBe('s1');
  });

  it('maps subagent events', () => {
    bridge.onAgentEvent({
      type: 'subagent',
      id: 'sub1',
      name: 'explorer',
      status: 'running',
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]!.type).toBe('SUBAGENT');
  });

  it('maps done events', () => {
    bridge.onAgentEvent({ type: 'done', reason: 'complete' });
    expect(posted.some((m) => m.type === 'DONE')).toBe(true);
  });

  it('maps error events', () => {
    bridge.onAgentEvent({ type: 'error', message: 'fail', fatal: true });
    expect(posted.some((m) => m.type === 'ERROR')).toBe(true);
    expect((posted.find((m) => m.type === 'ERROR') as any).message).toBe('fail');
  });

  it('maps warning events', () => {
    bridge.onAgentEvent({ type: 'warning', message: 'caution' });
    expect(posted.some((m) => m.type === 'WARNING')).toBe(true);
  });

  it('maps cache_usage events', () => {
    bridge.onAgentEvent({
      type: 'cache_usage',
      cacheReadInputTokens: 42,
      cacheWriteInputTokens: 7,
    });
    const msg = posted.find((m) => m.type === 'CACHE_USAGE') as any;
    expect(msg).toBeDefined();
    expect(msg.cacheReadInputTokens).toBe(42);
  });

  it('maps telemetry events', () => {
    bridge.onAgentEvent({
      type: 'telemetry',
      name: 'mcp_call',
      counters: {} as any,
      detail: 'list_tables',
    });
    expect(posted.some((m) => m.type === 'TELEMETRY')).toBe(true);
  });

  it('ignores events after dispose', async () => {
    bridge.dispose();
    bridge.onAgentEvent({ type: 'token_delta', text: 'late' });
    await vi.advanceTimersByTimeAsync(20);
    expect(posted).toHaveLength(0);
  });

  it('parseIncoming delegates to parseWebviewToHostMessage', () => {
    const msg = bridge.parseIncoming({ type: 'SUBMIT_TASK', text: 'ping' });
    expect(msg).toEqual({ type: 'SUBMIT_TASK', text: 'ping' });

    const bad = bridge.parseIncoming({ type: 'EVAL' });
    expect(bad).toBeNull();
  });

  it('postSnapshot flushes and sends STATE_SNAPSHOT', () => {
    bridge.onAgentEvent({ type: 'token_delta', text: 'pending' });
    bridge.postSnapshot({
      trusted: true,
      streaming: false,
      transcript: 'hello',
      autonomy: 'strict',
      pendingApproval: null,
    });
    const snap = posted.find((m) => m.type === 'STATE_SNAPSHOT') as any;
    expect(snap).toBeDefined();
    expect(snap.trusted).toBe(true);
    const tokenMsg = posted.find((m) => m.type === 'TOKEN_DELTA');
    expect(tokenMsg).toBeDefined();
  });

  it('postError flushes and sends ERROR', () => {
    bridge.onAgentEvent({ type: 'token_delta', text: 'buf' });
    bridge.postError('something broke');
    expect(posted.some((m) => m.type === 'TOKEN_DELTA')).toBe(true);
    const errMsg = posted.find((m) => m.type === 'ERROR') as any;
    expect(errMsg.message).toBe('something broke');
  });
});
