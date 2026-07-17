import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../../../../../packages/db/src/load-env.js';

const here = dirname(fileURLToPath(import.meta.url));
const infraBackendRoot = resolve(here, '../../../../..');

loadEnv(infraBackendRoot);

process.env.ALLOW_DEV_AUTH ??= 'true';
