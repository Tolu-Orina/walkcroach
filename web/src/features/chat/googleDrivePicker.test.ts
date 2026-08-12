/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  drivePickerCfgKey,
  drivePickerOutKey,
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
    localStorage.clear();
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

  it('writes config then opens /drive-picker.html and ignores popup.closed', async () => {
    vi.useFakeTimers();
    const popup = {
      closed: true,
      close: vi.fn(),
      postMessage: vi.fn(),
    };
    vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);

    const promise = openGoogleDrivePicker({
      accessToken: 'tok',
      apiKey: 'key',
      appId: '597871093388',
      maxItems: 3,
    });

    const openUrl = String(vi.mocked(window.open).mock.calls[0]?.[0] ?? '');
    const sid = new URL(openUrl, 'http://localhost').searchParams.get('sid');
    expect(sid).toBeTruthy();
    expect(openUrl).toContain('/drive-picker.html');

    const stored = JSON.parse(localStorage.getItem(drivePickerCfgKey(sid!)) ?? 'null');
    expect(stored).toMatchObject({
      accessToken: 'tok',
      apiKey: 'key',
      appId: '597871093388',
      maxItems: 3,
    });

    await vi.advanceTimersByTimeAsync(800);
    expect(popup.close).not.toHaveBeenCalled();

    localStorage.setItem(
      drivePickerOutKey(sid!),
      JSON.stringify({ type: 'picked', fileIds: ['file-a', 'file-b'] }),
    );
    await vi.advanceTimersByTimeAsync(250);

    await expect(promise).resolves.toEqual(['file-a', 'file-b']);
    expect(popup.close).not.toHaveBeenCalled();
    vi.useRealTimers();
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
