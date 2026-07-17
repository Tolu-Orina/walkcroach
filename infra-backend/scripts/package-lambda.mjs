/**
 * Bundle Lambda codes + workspace packages into modules/lambda-agent/.build/lambda.zip
 *
 *   cd infra-backend && npm run package:lambda
 */
import { mkdirSync, writeFileSync, createWriteStream, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'modules/lambda-agent/.build');
const entry = join(
  root,
  'modules/lambda-agent/codes/src/lambda-handler.ts',
);
const outfile = join(outDir, 'index.mjs');
const zipPath = join(outDir, 'lambda.zip');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log('esbuild bundle…');
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile,
  sourcemap: false,
  external: ['pg-native'],
  banner: {
    js: `import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);`,
  },
});

writeFileSync(
  join(outDir, 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2),
);

console.log('zip…');
await new Promise((resolve, reject) => {
  const output = createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  output.on('close', () => resolve(undefined));
  archive.on('error', reject);
  archive.pipe(output);
  archive.file(outfile, { name: 'index.mjs' });
  archive.file(join(outDir, 'package.json'), { name: 'package.json' });
  void archive.finalize();
});

console.log(`wrote ${zipPath}`);
