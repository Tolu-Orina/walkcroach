/** Sample prompt templates for Chat empty state (wireframe 2×2 grid). */
export type ChatTemplate = {
  id: string;
  title: string;
  prompt: string;
};

export const CHAT_TEMPLATES: ChatTemplate[] = [
  {
    id: 'draft-email',
    title: 'Draft Email message',
    prompt:
      'Help me draft a clear, professional email. Ask me who it is for, the goal, and any tone preferences before writing.',
  },
  {
    id: 'summarize-doc',
    title: 'Summarize a document',
    prompt:
      'I will paste or attach a document. Summarize the key points, decisions, and open questions in concise bullets.',
  },
  {
    id: 'research-topic',
    title: 'Research with web search',
    prompt:
      'Research this topic using web search and cite sources with titles and URLs. Start by asking what I need to know.',
  },
  {
    id: 'plan-app',
    title: 'Plan an app build',
    prompt:
      'Help me plan a small web app before we open App Builder. Clarify users, screens, and data — then outline build steps.',
  },
];
