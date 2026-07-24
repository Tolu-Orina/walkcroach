/**
 * Local HTTP server for Phase 0–2 development (no API Gateway required).
 *
 *   cd infra-backend && npm run dev
 */
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@walkcroach/db';
import { handleLocalRequest } from './local-app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// WalkCroach repo root: modules/lambda-agent/codes/src → ../../../../..
loadEnv(join(__dirname, '..', '..', '..', '..', '..'));
// Local-only: accept Bearer dev:user:* / dev:anon:* unless explicitly disabled.
process.env.ALLOW_DEV_AUTH ??= 'true';

const PORT = Number(process.env.PORT ?? 3001);

const server = createServer((req, res) => {
  void handleLocalRequest(req, res);
});

server.listen(PORT, () => {
  console.log(`walkcroach backend local http://localhost:${PORT}`);
  console.log(`ALLOW_DEV_AUTH=${process.env.ALLOW_DEV_AUTH}`);
});
