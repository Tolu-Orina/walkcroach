import { describe, expect, it, vi, afterEach } from 'vitest';
import { importDriveFiles } from './driveImport.js';
import type { TokenSet } from './oauth.js';

const tokens: TokenSet = {
  accessToken: 'ya29.test',
  scopes: ['https://www.googleapis.com/auth/drive.file'],
  expiresAt: Date.now() + 3_600_000,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('importDriveFiles', () => {
  it('imports a text file from Drive media download', async () => {
    const body = 'SSO decision: Okta SAML';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('fields=id,name')) {
          return new Response(
            JSON.stringify({
              id: 'file1',
              name: 'notes.txt',
              mimeType: 'text/plain',
              size: String(body.length),
            }),
            { status: 200 },
          );
        }
        if (url.includes('alt=media')) {
          return new Response(body, { status: 200 });
        }
        return new Response('unexpected', { status: 500 });
      }),
    );

    const result = await importDriveFiles({ tokens, fileIds: ['file1'] });
    expect('attachments' in result).toBe(true);
    if ('attachments' in result) {
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.name).toBe('notes.txt');
      expect(result.attachments[0]?.contentText).toContain('Okta');
      expect(result.attachments[0]?.sourceId).toBe('file1');
    }
  });

  it('exports a Google Doc as plain text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('fields=id,name')) {
          return new Response(
            JSON.stringify({
              id: 'doc1',
              name: 'Brief',
              mimeType: 'application/vnd.google-apps.document',
            }),
            { status: 200 },
          );
        }
        if (url.includes('/export?')) {
          return new Response('Exported body', { status: 200 });
        }
        return new Response('unexpected', { status: 500 });
      }),
    );

    const result = await importDriveFiles({ tokens, fileIds: ['doc1'] });
    expect('attachments' in result).toBe(true);
    if ('attachments' in result) {
      expect(result.attachments[0]?.mime).toBe('text/plain');
      expect(result.attachments[0]?.name).toBe('Brief.txt');
      expect(result.attachments[0]?.contentText).toBe('Exported body');
    }
  });

  it('rejects an empty selection', async () => {
    const result = await importDriveFiles({ tokens, fileIds: [] });
    expect(result).toMatchObject({ code: 'empty' });
  });
});
