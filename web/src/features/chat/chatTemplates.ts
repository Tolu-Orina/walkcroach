/** Sample prompt templates for Chat empty state (wireframe 2×2 grid). */
export type ChatTemplate = {
  id: string;
  title: string;
  /** Concise user-facing draft — never meta-instructions for the model. */
  prompt: string;
};

export const CHAT_TEMPLATES: ChatTemplate[] = [
  {
    id: 'draft-email',
    title: 'Draft Email message',
    prompt:
      'Draft a professional email for my boss requesting paid time off.',
  },
  {
    id: 'summarize-doc',
    title: 'Summarize a document',
    prompt:
      'Summarize the key points, decisions, and open questions from the attached document.',
  },
  {
    id: 'research-topic',
    title: 'Research with web search',
    prompt: 'Research this topic and cite sources with titles and URLs: ',
  },
  {
    id: 'plan-app',
    title: 'Plan an app build',
    prompt:
      'Help me plan a small web app — clarify users, screens, and data, then outline build steps.',
  },
];
