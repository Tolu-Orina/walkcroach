#!/usr/bin/env node
/**
 * `walkcroach-mcp serve` — run the memory MCP server locally.
 *
 * Point an MCP host at the printed URL. For Claude Code:
 *   claude mcp add --transport http walkcroach http://127.0.0.1:7801/mcp
 */
import { serve } from './http-server.js';

function usage(): never {
  console.error(
    [
      'walkcroach-mcp serve [--port N] [--base-url URL]',
      '',
      'Environment:',
      '  WALKCROACH_API_KEY   required — a wc_live_… service key',
      '  WALKCROACH_BASE_URL  optional — defaults to https://api.walkcroach.rinegansolutions.com',
    ].join('\n'),
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
if (argv[0] !== 'serve') usage();

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const apiKey = process.env.WALKCROACH_API_KEY;
if (!apiKey) {
  console.error('WALKCROACH_API_KEY is required. Mint one with: wc keys create');
  process.exit(1);
}

const port = Number(flag('port') ?? process.env.WALKCROACH_MCP_PORT ?? 7801);
const baseUrl = flag('base-url') ?? process.env.WALKCROACH_BASE_URL;

const { port: bound } = await serve({ apiKey, baseUrl, port });

// stderr, not stdout: 2026-07-28 deprecated the Logging feature and points
// implementations at stderr instead.
console.error(`walkcroach-mcp listening on http://127.0.0.1:${bound}`);
console.error(`  claude mcp add --transport http walkcroach http://127.0.0.1:${bound}/mcp`);
