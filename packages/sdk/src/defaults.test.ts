import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SDK_PACKAGE_VERSION } from './defaults.js';

describe('SDK_PACKAGE_VERSION', () => {
  it('matches package.json (User-Agent drift guard)', () => {
    const pkg = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
        'utf8',
      ),
    ) as { version: string };
    expect(SDK_PACKAGE_VERSION).toBe(pkg.version);
    expect(SDK_PACKAGE_VERSION).toBe('0.2.1');
  });
});
