import { describe, it, expect, vi } from 'vitest';
import { workspaceIdForPendingSave } from './selection-claim';

describe('workspaceIdForPendingSave', () => {
  it('uses the active workspace when set', async () => {
    const ensureNamed = vi.fn(async () => 'created');
    await expect(
      workspaceIdForPendingSave({
        activeWs: 'ws-1',
        ensureNamed,
        fallbackName: 'Saved',
      }),
    ).resolves.toBe('ws-1');
    expect(ensureNamed).not.toHaveBeenCalled();
  });

  it('creates via ensureNamed when active is empty', async () => {
    const ensureNamed = vi.fn(async (name: string) => `id-for-${name}`);
    await expect(
      workspaceIdForPendingSave({
        activeWs: '',
        ensureNamed,
        fallbackName: 'Saved',
      }),
    ).resolves.toBe('id-for-Saved');
    expect(ensureNamed).toHaveBeenCalledWith('Saved');
  });

  it('throws when ensureNamed returns empty', async () => {
    await expect(
      workspaceIdForPendingSave({
        activeWs: null,
        ensureNamed: async () => '',
        fallbackName: 'Saved',
      }),
    ).rejects.toThrow(/workspace/i);
  });
});
