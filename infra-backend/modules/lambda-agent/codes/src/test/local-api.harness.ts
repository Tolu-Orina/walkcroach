import { createServer, type Server } from 'node:http';
import supertest from 'supertest';
import { handleLocalRequest } from '../local-app.js';

let sharedServer: Server | null = null;

function getServer(): Server {
  if (!sharedServer) {
    sharedServer = createServer((req, res) => {
      void handleLocalRequest(req, res);
    });
  }
  return sharedServer;
}

export function api(): supertest.Agent {
  return supertest(getServer());
}

export function devBearer(ownerId: string): string {
  return `Bearer dev:${ownerId}`;
}

export function hasCrdb(): boolean {
  return Boolean(process.env.CRDB_CONNECTION_STRING?.trim());
}
