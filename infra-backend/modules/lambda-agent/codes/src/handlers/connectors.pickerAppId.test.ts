import { afterEach, describe, expect, it } from 'vitest';
import { resolveGooglePickerAppId } from './connectors.js';

describe('resolveGooglePickerAppId', () => {
  const prevNumber = process.env.GOOGLE_CLOUD_PROJECT_NUMBER;
  const prevApp = process.env.GOOGLE_PICKER_APP_ID;

  afterEach(() => {
    if (prevNumber === undefined) delete process.env.GOOGLE_CLOUD_PROJECT_NUMBER;
    else process.env.GOOGLE_CLOUD_PROJECT_NUMBER = prevNumber;
    if (prevApp === undefined) delete process.env.GOOGLE_PICKER_APP_ID;
    else process.env.GOOGLE_PICKER_APP_ID = prevApp;
  });

  it('prefers GOOGLE_CLOUD_PROJECT_NUMBER', () => {
    process.env.GOOGLE_CLOUD_PROJECT_NUMBER = '998877665544';
    expect(
      resolveGooglePickerAppId('123456789012-abc.apps.googleusercontent.com'),
    ).toBe('998877665544');
  });

  it('derives from OAuth client id when env unset', () => {
    delete process.env.GOOGLE_CLOUD_PROJECT_NUMBER;
    delete process.env.GOOGLE_PICKER_APP_ID;
    expect(
      resolveGooglePickerAppId('123456789012-abc.apps.googleusercontent.com'),
    ).toBe('123456789012');
  });

  it('returns null when neither is usable', () => {
    delete process.env.GOOGLE_CLOUD_PROJECT_NUMBER;
    delete process.env.GOOGLE_PICKER_APP_ID;
    expect(resolveGooglePickerAppId('bad.apps.googleusercontent.com')).toBeNull();
  });
});
