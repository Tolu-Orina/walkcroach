import { describe, it, expect } from 'vitest';
import { formatChatHandoffDraft } from './pending-chat-context';

describe('formatChatHandoffDraft', () => {
  it('builds a composer draft from page context', () => {
    const text = formatChatHandoffDraft({
      title: 'Example',
      url: 'https://example.com',
      extractedText: 'Hello world page body.',
      question: 'What is this?',
    });
    expect(text).toContain('Regarding: Example');
    expect(text).toContain('URL: https://example.com');
    expect(text).toContain('Hello world page body.');
    expect(text).toContain('Question: What is this?');
  });
});
