/**
 * Local HTTP server for Phase 0–2 development (no API Gateway required).
 *
 *   cd infra-backend && npm run dev
 */
import { createServer } from 'node:http';
import { handleLocalRequest } from './local-app.js';

const PORT = Number(process.env.PORT ?? 3001);

const server = createServer((req, res) => {
  void handleLocalRequest(req, res);
});

server.listen(PORT, () => {
  console.log(`walkcroach backend local http://localhost:${PORT}`);
});
