import { describe, expect, it } from 'vitest';
import { readDeviceAttachment, sourceLabel } from './attachTypes';

describe('attachTypes', () => {
  it('labels attachment sources for chips', () => {
    expect(sourceLabel('device')).toBe('Device');
    expect(sourceLabel('project')).toBe('Project');
    expect(sourceLabel('google_drive')).toBe('Drive');
    expect(sourceLabel(undefined)).toBeNull();
  });

  it('reads a text device file into a chat attachment', async () => {
    const file = new File(['hello memory'], 'note.md', { type: 'text/markdown' });
    const att = await readDeviceAttachment(file);
    expect(att.source).toBe('device');
    expect(att.name).toBe('note.md');
    expect(att.contentText).toContain('hello memory');
  });
});
