import { describe, expect, it } from 'vitest';
import { buildDriveListQuery } from './driveBrowse.js';

describe('buildDriveListQuery', () => {
  it('lists My Drive children of root', () => {
    const built = buildDriveListQuery({ view: 'my_drive' });
    expect('params' in built).toBe(true);
    if (!('params' in built)) return;
    expect(built.path).toBe('/files');
    expect(built.params.get('q')).toContain("'root' in parents");
    expect(built.params.get('q')).toContain('trashed = false');
  });

  it('escapes search quotes', () => {
    const built = buildDriveListQuery({
      view: 'my_drive',
      q: "O'Brien",
    });
    expect('params' in built).toBe(true);
    if (!('params' in built)) return;
    expect(built.params.get('q')).toContain("name contains 'O\\'Brien'");
  });

  it('lists shared drives catalog without a files query', () => {
    const built = buildDriveListQuery({ view: 'shared_drives' });
    expect('path' in built && built.path === '/drives').toBe(true);
  });

  it('rejects malformed folder ids', () => {
    const built = buildDriveListQuery({
      view: 'my_drive',
      folderId: "root' in parents or 'x",
    });
    expect(built).toMatchObject({ code: 'bad_request' });
  });
});
