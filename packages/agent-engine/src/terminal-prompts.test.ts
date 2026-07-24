import { describe, expect, it } from 'vitest';
import {
  detectConfirmPrompt,
  looksLikePasswordPrompt,
} from './terminal-prompts.js';
import { streamShellCommand } from './stream-shell.js';
import { createFakeHost } from './fake-host.js';
import { executeTool } from './tools/execute.js';

describe('detectConfirmPrompt', () => {
  it('matches [y/N] and (yes/no)', () => {
    const a = detectConfirmPrompt('Install packages? [y/N] ');
    expect(a?.matched).toMatch(/\[y\/N\]/);
    expect(a?.options).toEqual(['y', 'N']);

    const b = detectConfirmPrompt('Delete forever (yes/no)? ');
    expect(b?.options).toContain('yes');
  });

  it('returns null for plain logs', () => {
    expect(detectConfirmPrompt('compiled successfully\n')).toBeNull();
  });

  it('looksLikePasswordPrompt catches sudo/password', () => {
    expect(looksLikePasswordPrompt('[sudo] password for user: ')).toBe(true);
    expect(looksLikePasswordPrompt('Continue? [y/N]')).toBe(false);
  });
});

describe('streamShellCommand — Tier B confirm', () => {
  it('asks onConfirmPrompt and writes the reply', async () => {
    const cmd =
      "node -e \"const rl=require('readline').createInterface({input:process.stdin,output:process.stdout});process.stdout.write('Continue? [y/N] ');rl.question('',(a)=>{process.stdout.write('got:'+String(a).trim()+'\\\\n');rl.close();process.exit(String(a).trim().toLowerCase()==='y'?0:2);})\"";

    let asked = 0;
    let out = '';
    let code: number | null | undefined;
    for await (const chunk of streamShellCommand(cmd, {
      cwd: process.cwd(),
      timeoutMs: 20_000,
      confirmIdleMs: 150,
      onConfirmPrompt: async (req) => {
        asked += 1;
        expect(req.matched).toMatch(/y\/N/i);
        return 'y';
      },
    })) {
      out += chunk.text;
      if (chunk.exitCode !== undefined) code = chunk.exitCode;
    }
    expect(asked).toBe(1);
    expect(code).toBe(0);
    expect(out).toMatch(/got:y/i);
  });

  it('aborts on password-like prompts without asking', async () => {
    const cmd =
      "node -e \"process.stdout.write('Password: '); setTimeout(()=>{}, 5000)\"";
    let asked = 0;
    let out = '';
    for await (const chunk of streamShellCommand(cmd, {
      cwd: process.cwd(),
      timeoutMs: 8_000,
      confirmIdleMs: 100,
      onConfirmPrompt: async () => {
        asked += 1;
        return 'secret';
      },
    })) {
      out += chunk.text;
    }
    expect(asked).toBe(0);
    expect(out).toMatch(/Password\/sudo prompt detected/i);
  });
});

describe('executeTool — Tier B via ask_user', () => {
  it('bridges confirm prompt to askUser (autoApprove picks first option)', async () => {
    const host = createFakeHost({ autoApprove: true });
    // Fake host auto-approve resolves ask_user to first option — which for
    // [y/N] options becomes ['Y','n','abort'] after we add abort — first is Y.
    // Our detect for the node script uses [y/N] → options y, N.
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'c1',
        name: 'run_terminal',
        input: {
          cmd: '__WALKCROACH_CONFIRM_STREAM__',
          interactive: true,
        },
      },
    });
    expect(result.status).toBe('success');
    expect(result.content).toMatch(/got:y/i);
  });
});
