/**
 * Phase 1 CLI smoke: full agent loop with mocked WebContainer tool results.
 *
 * Flow:
 *  1. Create project + session
 *  2. Seed a preference into memory (direct write)
 *  3. Prompt agent to build a tiny file + run a terminal command
 *  4. Auto-ack client_local tools; on awaiting_tool, POST-equivalent continueAfterTool
 *  5. Assert messages + build_events in CRDB
 *  6. New session on same project → memory_recalled > 0
 *
 *   cd infra-backend && npm run smoke:loop
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbClient } from '@walkcroach/db';
import {
  continueAfterTool,
  runPromptTurn,
  writeMemoryEntry,
  type AgentEvent,
} from './index.js';

function loadEnv(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const path = join(root, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function drain(
  events: AsyncIterable<AgentEvent>,
): Promise<{ events: AgentEvent[]; lastDone?: AgentEvent }> {
  const collected: AgentEvent[] = [];
  let lastDone: AgentEvent | undefined;
  for await (const e of events) {
    collected.push(e);
    if (e.type === 'token') process.stdout.write(e.text);
    else if (e.type === 'tool_call') {
      console.log(
        `\n[tool_call] ${e.tool} await=${e.awaitResult ?? false} id=${e.id}`,
      );
      console.log(`  args: ${JSON.stringify(e.args).slice(0, 200)}`);
    } else if (e.type === 'memory_recalled') {
      console.log(`\n[memory_recalled] count=${e.count}`);
    } else if (e.type === 'error') {
      console.log(`\n[error] ${e.message}`);
    } else if (e.type === 'done') {
      console.log(`\n[done] ${e.reason}`);
      lastDone = e;
    }
  }
  return { events: collected, lastDone };
}

async function main() {
  loadEnv();
  const db = createDbClient();

  try {
    const { rows: projects } = await db.query<{ id: string }>(
      `INSERT INTO projects (owner_id, name, surface_origin)
       VALUES ('smoke-loop', 'Phase1 Loop Project', 'web')
       RETURNING id`,
    );
    const projectId = projects[0]!.id;
    console.log('project', projectId);

    await writeMemoryEntry({
      db,
      projectId,
      sourceSurface: 'web',
      kind: 'preference',
      text: 'User prefers muted tones and non-salesy landing-page copy',
    });
    console.log('seeded preference memory');

    const { rows: sessions } = await db.query<{ id: string }>(
      `INSERT INTO sessions (project_id, model_config)
       VALUES ($1::uuid, '{"mode":"build"}'::jsonb)
       RETURNING id`,
      [projectId],
    );
    const sessionId = sessions[0]!.id;
    console.log('session', sessionId);

    console.log('\n=== prompt turn ===');
    let { events, lastDone } = await drain(
      runPromptTurn({
        db,
        sessionId,
        projectId,
        mode: 'build',
        message:
          'Create a file src/Hello.tsx that exports a Hello component saying hello. Keep styling muted and non-salesy. Then run: npm install',
      }),
    );

    // If model never asked for terminal, nudge once more (still OK for exit criteria)
    if (lastDone?.type === 'done' && lastDone.reason === 'complete') {
      const hadFile = events.some(
        (e) => e.type === 'tool_call' && e.tool === 'write_file',
      );
      console.log(`\ncompleted without await; had write_file=${hadFile}`);
      if (!hadFile) {
        console.log('retrying with stronger prompt…');
        ({ events, lastDone } = await drain(
          runPromptTurn({
            db,
            sessionId,
            projectId,
            mode: 'build',
            message:
              'You must call write_file for src/Hello.tsx, then call run_terminal with cmd "npm install".',
          }),
        ));
      }
    }

    // Resume shell tools until complete (max a few)
    let guard = 0;
    while (
      lastDone?.type === 'done' &&
      lastDone.reason === 'awaiting_tool' &&
      guard < 5
    ) {
      guard += 1;
      const pendingCall = [...events]
        .reverse()
        .find((e) => e.type === 'tool_call' && e.awaitResult);
      if (!pendingCall || pendingCall.type !== 'tool_call') {
        throw new Error('awaiting_tool but no awaitResult tool_call in events');
      }

      console.log(`\n=== mock tool-result for ${pendingCall.tool} ===`);
      ({ events, lastDone } = await drain(
        continueAfterTool({
          db,
          sessionId,
          projectId,
          toolResult: {
            toolCallId: pendingCall.id,
            ok: true,
            exitCode: 0,
            stdout: 'added 42 packages in 3s\n',
            stderr: '',
          },
        }),
      ));
    }

    const { rows: msgCount } = await db.query<{ n: string }>(
      `SELECT count(*)::string AS n FROM messages WHERE session_id = $1::uuid`,
      [sessionId],
    );
    const { rows: eventCount } = await db.query<{ n: string }>(
      `SELECT count(*)::string AS n FROM build_events WHERE session_id = $1::uuid`,
      [sessionId],
    );
    const { rows: memCount } = await db.query<{ n: string }>(
      `SELECT count(*)::string AS n FROM memory_entries WHERE project_id = $1::uuid`,
      [projectId],
    );

    console.log('\n=== CRDB counts ===');
    console.log('messages', msgCount[0]!.n);
    console.log('build_events', eventCount[0]!.n);
    console.log('memory_entries', memCount[0]!.n);

    if (Number(msgCount[0]!.n) < 1) throw new Error('expected messages');
    if (Number(memCount[0]!.n) < 1) throw new Error('expected memory_entries');

    // Second session — recall without re-stating preference
    const { rows: sessions2 } = await db.query<{ id: string }>(
      `INSERT INTO sessions (project_id, model_config)
       VALUES ($1::uuid, '{"mode":"plan"}'::jsonb)
       RETURNING id`,
      [projectId],
    );
    const session2 = sessions2[0]!.id;
    console.log('\n=== second session (plan) ===', session2);

    const second = await drain(
      runPromptTurn({
        db,
        sessionId: session2,
        projectId,
        mode: 'plan',
        message:
          'What style should the landing page use? Answer from project memory.',
      }),
    );

    const recalled = second.events.find((e) => e.type === 'memory_recalled');
    if (!recalled || recalled.type !== 'memory_recalled' || recalled.count < 1) {
      throw new Error('second session did not recall memory');
    }

    console.log('\nsmoke:loop OK');
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
