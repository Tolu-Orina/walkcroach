import React from 'react';
import { render } from 'ink';
import type { AgentEvent } from '@walkcroach/agent-engine';
import { TuiApp } from './App.js';

export type RunTuiOptions = {
  task: string;
  signedIn?: boolean;
  linkedProjectName?: string | null;
  mcpConfigured?: boolean;
  subscribe: (fn: (e: AgentEvent) => void) => () => void;
  onApprove: (stepId: string) => void;
  onReject: (stepId: string) => void;
  onCancel: () => void;
};

/** Mount Ink TUI until the agent run completes or user cancels. */
export async function runTui(opts: RunTuiOptions): Promise<void> {
  const instance = render(
    <TuiApp
      task={opts.task}
      signedIn={opts.signedIn}
      linkedProjectName={opts.linkedProjectName}
      mcpConfigured={opts.mcpConfigured}
      subscribe={opts.subscribe}
      onApprove={opts.onApprove}
      onReject={opts.onReject}
      onCancel={opts.onCancel}
    />,
  );
  await instance.waitUntilExit();
}
