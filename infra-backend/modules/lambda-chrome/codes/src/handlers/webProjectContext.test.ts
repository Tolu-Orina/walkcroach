import { describe, expect, it } from 'vitest';
import {
  formatWebProjectBlock,
  textFromMessageContent,
} from './webProjectContext.js';

describe('textFromMessageContent', () => {
  it('reads Converse text blocks', () => {
    expect(
      textFromMessageContent([{ text: 'Use the Graphite Lumen tokens.' }]),
    ).toBe('Use the Graphite Lumen tokens.');
  });

  it('reads a plain string', () => {
    expect(textFromMessageContent('hello')).toBe('hello');
  });
});

describe('formatWebProjectBlock', () => {
  it('is empty when there is nothing to ground on', () => {
    expect(
      formatWebProjectBlock({
        projectId: null,
        projectName: null,
        memoryLines: [],
        chatLines: [],
      }),
    ).toBe('');
  });

  it('names the Web project and includes chat plus memory', () => {
    const block = formatWebProjectBlock({
      projectId: 'p1',
      projectName: 'Agentic Project',
      memoryLines: ['- [web|decision] Enterprise design system'],
      chatLines: ['You: What should the design system be?'],
    });
    expect(block).toContain('Agentic Project');
    expect(block).toContain('Enterprise design system');
    expect(block).toContain('What should the design system be?');
  });
});
