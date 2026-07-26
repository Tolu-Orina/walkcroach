import * as esbuild from 'esbuild';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const watch = process.argv.includes('--watch');
const ideRoot = dirname(fileURLToPath(import.meta.url));
const officialJsonSrc = join(
  ideRoot,
  '../packages/agent-engine/src/skills/cockroachdb-official.generated.json',
);
const officialJsonDest = join(
  ideRoot,
  'dist/cockroachdb-official.generated.json',
);

function copyOfficialSkillsJson() {
  if (!existsSync(officialJsonSrc)) {
    throw new Error(
      `Missing ${officialJsonSrc} — run agent-engine sync:cockroachdb-skills or restore the JSON asset`,
    );
  }
  mkdirSync(dirname(officialJsonDest), { recursive: true });
  copyFileSync(officialJsonSrc, officialJsonDest);
  console.log('copied cockroachdb-official.generated.json → dist/');
}

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.cjs',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  minify: true,
  sourcemap: true,
  sourcesContent: false,
  logLevel: 'info',
  plugins: [
    {
      name: 'copy-official-skills',
      setup(build) {
        build.onStart(() => {
          copyOfficialSkillsJson();
        });
      },
    },
  ],
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
