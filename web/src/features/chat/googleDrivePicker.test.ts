/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openGoogleDrivePicker,
  projectNumberFromClientId,
} from './googleDrivePicker';

describe('projectNumberFromClientId', () => {
  it('extracts numeric prefix from a standard OAuth web client id', () => {
    expect(
      projectNumberFromClientId(
        '123456789012-abcdefg.apps.googleusercontent.com',
      ),
    ).toBe('123456789012');
  });

  it('rejects non-numeric prefixes', () => {
    expect(projectNumberFromClientId('not-a-number-xyz.apps.googleusercontent.com')).toBeNull();
  });

  it('rejects empty', () => {
    expect(projectNumberFromClientId('')).toBeNull();
  });
});

describe('openGoogleDrivePicker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects invalid appId before opening a window', async () => {
    const open = vi.spyOn(window, 'open');
    await expect(
      openGoogleDrivePicker({
        accessToken: 'tok',
        apiKey: 'key',
        appId: 'not-digits',
      }),
    ).rejects.toThrow(/project number/i);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens /drive-picker.html popup and resolves picked ids via postMessage', async () => {
    const popup = {
      closed: false,
      close: vi.fn(),
      postMessage: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);

    const promise = openGoogleDrivePicker({
      accessToken: 'tok',
      apiKey: 'key',
      appId: '597871093388',
      maxItems: 3,
    });

    // Simulate popup ready + pick
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { source: 'wc-drive-picker', type: 'ready' },
      }),
    );
    expect(popup.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'wc-drive-picker-host',
        type: 'config',
        accessToken: 'tok',
        apiKey: 'key',
        appId: '597871093388',
        maxItems: 3,
      }),
      window.location.origin,
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          source: 'wc-drive-picker',
          type: 'picked',
          fileIds: ['file-a', 'file-b'],
        },
      }),
    );

    await expect(promise).resolves.toEqual(['file-a', 'file-b']);
    expect(popup.close).toHaveBeenCalled();
  });

  it('errors when the popup is blocked', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    await expect(
      openGoogleDrivePicker({
        accessToken: 'tok',
        apiKey: 'key',
        appId: '597871093388',
      }),
    ).rejects.toThrow(/pop-up blocked/i);
  });
});
