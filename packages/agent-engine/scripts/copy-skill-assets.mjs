/**
 * Copy JSON skill assets into dist/ (tsc does not emit non-TS files).
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(
  root,
  'src/skills/cockroachdb-official.generated.json',
);
const dest = join(
  root,
  'dist/skills/cockroachdb-official.generated.json',
);

if (!existsSync(src)) {
  console.error(`Missing ${src}`);
  process.exit(1);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log('copied', 'cockroachdb-official.generated.json', '→ dist/skills/');
