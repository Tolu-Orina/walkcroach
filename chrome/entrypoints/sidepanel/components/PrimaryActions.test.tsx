// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { formatSaveLabel, PrimaryActions } from './PrimaryActions';

afterEach(cleanup);

const noop = () => undefined;

describe('formatSaveLabel', () => {
  it('omits the workspace arrow when unnamed', () => {
    expect(formatSaveLabel('')).toBe('Save');
  });

  it('shows the workspace destination on both profile and generic paths', () => {
    expect(formatSaveLabel('Leads')).toBe('Save → Leads');
  });

  it('truncates long workspace names for narrow panels', () => {
    expect(formatSaveLabel('Very Long Workspace Name Here')).toBe(
      'Save → Very Long Works…',
    );
  });
});

describe('PrimaryActions', () => {
  it('keeps the Save destination on the profile secondary row', () => {
    render(
      <PrimaryActions
        profile={{
          id: 'jobs',
          sector: 'recruiting',
          label: 'Extract role',
          actionId: 'extract_role',
          captureType: 'job',
          defaultWorkspace: 'Candidates',
          match: { hostSuffix: ['boards.example.com'], pathIncludes: [] },
          fields: ['title', 'company'],
        }}
        disabled={false}
        streaming={false}
        primaryDemoted={false}
        activeWorkspaceName="Candidates"
        onSectorAction={noop}
        onSummarize={noop}
        onDraft={noop}
        onSave={noop}
        onOpenInWebChat={noop}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Save → Candidates' }),
    ).toBeInTheDocument();
  });

  it('marks Open in Web Chat as leaving the panel', () => {
    render(
      <PrimaryActions
        profile={null}
        disabled={false}
        streaming={false}
        primaryDemoted={false}
        activeWorkspaceName=""
        onSectorAction={noop}
        onSummarize={noop}
        onDraft={noop}
        onSave={noop}
        onOpenInWebChat={noop}
      />,
    );
    const webChat = screen.getByRole('button', { name: /Open in Web Chat/ });
    expect(webChat.querySelector('svg')).toBeTruthy();
  });
});
