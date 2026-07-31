import { describe, expect, it } from 'vitest';
import { s3UriToObjectKey } from './video.js';

describe('s3UriToObjectKey', () => {
  it('parses s3://bucket/key paths', () => {
    expect(s3UriToObjectKey('s3://wc-artefacts/video-jobs/u/j/out.mp4')).toBe(
      'video-jobs/u/j/out.mp4',
    );
  });

  it('returns null for empty / bucket-only', () => {
    expect(s3UriToObjectKey(null)).toBeNull();
    expect(s3UriToObjectKey('')).toBeNull();
    expect(s3UriToObjectKey('s3://bucket-only')).toBeNull();
  });

  it('passes through plain keys', () => {
    expect(s3UriToObjectKey('video-jobs/a/b.mp4')).toBe('video-jobs/a/b.mp4');
  });
});
