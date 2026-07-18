import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type {
  AgentEvent,
  ApprovalRequest,
} from '@walkcroach/agent-engine';

export type ToolCard = {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  detail?: string;
};

export type TuiProps = {
  task: string;
  signedIn?: boolean;
  linkedProjectName?: string | null;
  mcpConfigured?: boolean;
  /** Subscribe to host events; returns unsubscribe. */
  subscribe: (fn: (e: AgentEvent) => void) => () => void;
  onApprove: (stepId: string) => void;
  onReject: (stepId: string) => void;
  onCancel: () => void;
};

function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

/**
 * Ink TUI — visual parity with the IDE webview panel (brand, phase, tools, approvals, transcript).
 */
export function TuiApp(props: TuiProps): React.ReactElement {
  const { exit } = useApp();
  const [phase, setPhase] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [tools, setTools] = useState<ToolCard[]>([]);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [cacheHint, setCacheHint] = useState<string | null>(null);

  useEffect(() => {
    return props.subscribe((event) => {
      switch (event.type) {
        case 'phase':
          setPhase(event.phase);
          break;
        case 'token_delta':
          setTranscript((t) => t + event.text);
          break;
        case 'tool_card':
          setTools((prev) => {
            const i = prev.findIndex((t) => t.id === event.id);
            const next: ToolCard = {
              id: event.id,
              name: event.name,
              status: event.status,
              detail: event.detail,
            };
            if (i < 0) return [...prev, next];
            const copy = [...prev];
            copy[i] = next;
            return copy;
          });
          break;
        case 'approval_request':
          setApproval(event.request);
          break;
        case 'cache_usage':
          setCacheHint(
            `cache r=${event.cacheReadInputTokens} w=${event.cacheWriteInputTokens}`,
          );
          break;
        case 'done':
          setDone(event.reason);
          setApproval(null);
          setPhase(null);
          break;
        case 'error':
          setError(event.message);
          setApproval(null);
          break;
        default:
          break;
      }
    });
  }, [props]);

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      props.onCancel();
      exit();
      return;
    }
    if (!approval) return;
    if (input === 'a' || input === 'y') {
      props.onApprove(approval.stepId);
      setApproval(null);
      return;
    }
    if (input === 'r' || input === 'n') {
      props.onReject(approval.stepId);
      setApproval(null);
    }
  });

  useEffect(() => {
    if (done || error) {
      const t = setTimeout(() => exit(), 80);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [done, error, exit]);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box>
        <Text bold color="cyan">
          WalkCroach
        </Text>
        <Text dimColor>  Phase D CLI</Text>
      </Box>
      <Text dimColor>
        Auth: {props.signedIn ? 'signed in' : 'signed out'}
        {' · '}
        Link: {props.linkedProjectName || 'not linked'}
        {' · '}
        MCP: {props.mcpConfigured ? 'configured' : 'off'}
      </Text>
      <Text>
        Task: <Text color="white">{clip(props.task, 100)}</Text>
      </Text>
      {phase ? (
        <Text color="yellow">
          Phase: {phase}
          {cacheHint ? `  ${cacheHint}` : ''}
        </Text>
      ) : null}

      {error ? (
        <Box borderStyle="round" borderColor="red" paddingX={1} marginY={1}>
          <Text color="red">{error}</Text>
        </Box>
      ) : null}

      {approval ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="magenta"
          paddingX={1}
          marginY={1}
        >
          <Text bold color="magenta">
            Approve {approval.toolName} ({approval.kind})
          </Text>
          {approval.path ? <Text dimColor>{approval.path}</Text> : null}
          {approval.kind === 'command' ? (
            <Text>{clip(approval.cmd ?? '', 500)}</Text>
          ) : (
            <Box flexDirection="column">
              <Text dimColor>before:</Text>
              <Text>{clip(approval.before ?? '', 400)}</Text>
              <Text dimColor>after:</Text>
              <Text>{clip(approval.after ?? '', 400)}</Text>
            </Box>
          )}
          <Text color="green">[a]pprove</Text>
          <Text color="red">[r]eject</Text>
          <Text dimColor>esc cancel</Text>
        </Box>
      ) : null}

      {tools.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Tools</Text>
          {tools.slice(-8).map((t) => (
            <Text key={t.id}>
              {'  '}
              <Text color={statusColor(t.status)}>{t.status}</Text>
              {'  '}
              {t.name}
              {t.detail ? <Text dimColor> — {clip(t.detail, 60)}</Text> : null}
            </Text>
          ))}
        </Box>
      ) : null}

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Output</Text>
        <Text>{clip(transcript, 2400) || (done ? '' : '…')}</Text>
      </Box>

      {done ? (
        <Box marginTop={1}>
          <Text color="green">✓ done ({done})</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function statusColor(
  s: ToolCard['status'],
): 'yellow' | 'cyan' | 'green' | 'red' | undefined {
  if (s === 'pending') return 'yellow';
  if (s === 'running') return 'cyan';
  if (s === 'done') return 'green';
  if (s === 'error') return 'red';
  return undefined;
}
