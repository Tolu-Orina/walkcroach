#!/usr/bin/env node
/**
 * Ensure dist/bin.js keeps a shebang after tsc (npm drops bin entries without one).
 */
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bin = join(root, 'dist', 'bin.js');
let code = await readFile(bin, 'utf8');
if (!code.startsWith('#!')) {
  code = `#!/usr/bin/env node\n${code}`;
  await writeFile(bin, code, 'utf8');
}
try {
  await chmod(bin, 0o755);
} catch {
  // Windows has no executable bit.
}
