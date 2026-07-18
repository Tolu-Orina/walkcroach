import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempDir: string;
const origHome = process.env.WALKCROACH_HOME;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'wc-link-'));
  process.env.WALKCROACH_HOME = tempDir;
});

afterEach(async () => {
  if (origHome !== undefined) process.env.WALKCROACH_HOME = origHome;
  else delete process.env.WALKCROACH_HOME;
  await rm(tempDir, { recursive: true, force: true });
});

const mockCreateLink = vi.fn().mockResolvedValue({
  id: 'lnk-1',
  projectId: 'p1',
  localRepoKey: 'path:abc',
});
const mockDeleteLink = vi.fn().mockResolvedValue(undefined);
const mockIdeMe = vi.fn().mockResolvedValue({
  ownerId: 'u1',
  link: { id: 'lnk-1' },
  linkCount: 1,
});
const mockListMyProjects = vi.fn().mockResolvedValue([
  { id: 'p1', name: 'Proj One', status: 'active', updated_at: '2025-01-01' },
]);

vi.mock('../lib/api.js', () => ({
  createLink: (...args: unknown[]) => mockCreateLink(...args),
  deleteLink: (...args: unknown[]) => mockDeleteLink(...args),
  ideMe: (...args: unknown[]) => mockIdeMe(...args),
  listMyProjects: (...args: unknown[]) => mockListMyProjects(...args),
}));

import { linkProject, unlinkProject, listProjects, linkStatus } from './link.js';
import { setSecret } from '../lib/config.js';
import { SECRET_KEYS } from '@walkcroach/agent-engine';

async function seedToken() {
  await setSecret(SECRET_KEYS.cognitoAccessToken, 'test-token');
}

describe('linkProject', () => {
  it('creates a link and returns 0', async () => {
    await seedToken();
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await linkProject({ projectId: 'p1', cwd: tempDir });
    expect(code).toBe(0);
    expect(mockCreateLink).toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });

  it('returns 1 when not signed in', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await linkProject({ projectId: 'p1', cwd: tempDir });
    expect(code).toBe(1);
    stderrSpy.mockRestore();
  });
});

describe('unlinkProject', () => {
  it('removes link and returns 0', async () => {
    await seedToken();
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await unlinkProject({ cwd: tempDir });
    expect(code).toBe(0);
    expect(mockDeleteLink).toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });

  it('handles no link gracefully', async () => {
    await seedToken();
    mockIdeMe.mockResolvedValueOnce({ ownerId: 'u1', link: null, linkCount: 0 });
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await unlinkProject({ cwd: tempDir });
    expect(code).toBe(0);
    stdoutSpy.mockRestore();
  });
});

describe('listProjects', () => {
  it('lists projects when signed in', async () => {
    await seedToken();
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await listProjects({});
    expect(code).toBe(0);
    expect(mockListMyProjects).toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });

  it('returns 1 when not signed in', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await listProjects({});
    expect(code).toBe(1);
    stderrSpy.mockRestore();
  });
});

describe('linkStatus', () => {
  it('shows link status when signed in', async () => {
    await seedToken();
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await linkStatus({ cwd: tempDir });
    expect(code).toBe(0);
    stdoutSpy.mockRestore();
  });
});
