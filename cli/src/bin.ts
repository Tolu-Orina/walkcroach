#!/usr/bin/env node
import { buildProgram } from './program.js';
import { EXIT, exitCodeForError } from './lib/exit-codes.js';

/**
 * Ctrl-C is a normal way to end an agent run, not a crash. 130 is the shell
 * convention (128 + SIGINT), and reporting it distinctly means a CI job can
 * tell "cancelled" apart from "failed".
 */
process.on('SIGINT', () => {
  process.exitCode = EXIT.INTERRUPTED;
  process.exit(EXIT.INTERRUPTED);
});

try {
  await buildProgram().parseAsync(process.argv);
} catch (err) {
  // Commander throws for usage errors it has already reported; anything else
  // reaching here is unhandled, and must still leave a meaningful exit code
  // rather than Node's generic 1.
  const message = err instanceof Error ? err.message : String(err);
  if (message) process.stderr.write(`${message}\n`);
  process.exitCode = exitCodeForError(err);
}
