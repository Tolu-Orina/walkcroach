import { describe, expect, it } from 'vitest';
import type { Message } from '@aws-sdk/client-bedrock-runtime';
import {
  appendUserFollowUp,
  cloneMessages,
  trimSessionMessages,
} from './session.js';

describe('appendUserFollowUp', () => {
  it('pushes a new user turn when the prior message is not user (unchanged text-only behavior)', () => {
    const prior: Message[] = [
      { role: 'user', content: [{ text: 'first' }] },
      { role: 'assistant', content: [{ text: 'reply' }] },
    ];
    const result = appendUserFollowUp(prior, 'second');
    expect(result).toEqual([
      ...prior,
      { role: 'user', content: [{ text: 'second' }] },
    ]);
  });

  it('appends to the trailing user turn when the prior message is already user (unchanged text-only behavior)', () => {
    const prior: Message[] = [{ role: 'user', content: [{ text: 'first' }] }];
    const result = appendUserFollowUp(prior, 'second');
    expect(result).toEqual([
      { role: 'user', content: [{ text: 'first' }, { text: 'second' }] },
    ]);
  });

  it('includes extraBlocks (attachments) alongside the text block on a fresh user turn', () => {
    const prior: Message[] = [
      { role: 'user', content: [{ text: 'first' }] },
      { role: 'assistant', content: [{ text: 'reply' }] },
    ];
    const image = { image: { format: 'png' as const, source: { bytes: new Uint8Array([1]) } } };
    const result = appendUserFollowUp(prior, 'second', [image]);
    expect(result[2]).toEqual({
      role: 'user',
      content: [{ text: 'second' }, image],
    });
  });

  it('includes extraBlocks when appending to an existing trailing user turn', () => {
    const prior: Message[] = [{ role: 'user', content: [{ text: 'first' }] }];
    const image = { image: { format: 'png' as const, source: { bytes: new Uint8Array([1]) } } };
    const result = appendUserFollowUp(prior, 'second', [image]);
    expect(result).toEqual([
      { role: 'user', content: [{ text: 'first' }, { text: 'second' }, image] },
    ]);
  });

  it('does not mutate the prior array', () => {
    const prior: Message[] = [{ role: 'user', content: [{ text: 'first' }] }];
    const before = JSON.stringify(prior);
    appendUserFollowUp(prior, 'second', [
      { image: { format: 'png', source: { bytes: new Uint8Array([1]) } } },
    ]);
    expect(JSON.stringify(prior)).toBe(before);
  });
});

describe('cloneMessages / trimSessionMessages (regression coverage)', () => {
  it('clones content arrays (shallow) so pushes to the clone do not affect the source', () => {
    const original: Message[] = [{ role: 'user', content: [{ text: 'a' }] }];
    const clone = cloneMessages(original);
    clone[0]!.content!.push({ text: 'b' });
    expect(original[0]!.content).toHaveLength(1);
  });

  it('keeps all messages when under the max', () => {
    const messages: Message[] = [{ role: 'user', content: [{ text: 'a' }] }];
    expect(trimSessionMessages(messages, 10)).toBe(messages);
  });
});
