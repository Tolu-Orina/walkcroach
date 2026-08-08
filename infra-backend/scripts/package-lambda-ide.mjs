/**
 * Bundle IDE BFF into modules/lambda-ide/.build/lambda.zip
 *
 * Includes skills/web so the worker's load_skill catalog is non-empty
 * (WALKCROACH_WEB_SKILLS_DIR=/var/task/skills/web).
 *
 *   cd infra-backend && npm run package:lambda:ide
 */
import {
  mkdirSync,
  writeFileSync,
  createWriteStream,
  rmSync,
  existsSync,
  readdirSync,
  statSync,
  copyFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const repoRoot = join(root, '..');
const outDir = join(root, 'modules/lambda-ide/.build');
const entry = join(root, 'modules/lambda-ide/codes/src/lambda-handler.ts');
const outfile = join(outDir, 'index.mjs');
const zipPath = join(outDir, 'lambda.zip');
const skillsSrc = join(repoRoot, 'skills', 'web');
const skillsDest = join(outDir, 'skills', 'web');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log('esbuild ide bundle…');
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

if (!existsSync(skillsSrc)) {
  console.warn(`WARN: skills/web not found at ${skillsSrc} — worker load_skill will be empty`);
} else {
  console.log('copy skills/web into bundle…');
  copyDir(skillsSrc, skillsDest);
}

console.log('zip…');
await new Promise((resolve, reject) => {
  const output = createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  output.on('close', () => resolve(undefined));
  archive.on('error', reject);
  archive.pipe(output);
  archive.file(outfile, { name: 'index.mjs' });
  archive.file(join(outDir, 'package.json'), { name: 'package.json' });
  if (existsSync(skillsDest)) {
    archive.directory(skillsDest, 'skills/web');
  }
  void archive.finalize();
});

console.log(`wrote ${zipPath}`);

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    if (statSync(from).isDirectory()) copyDir(from, to);
    else copyFileSync(from, to);
  }
}
