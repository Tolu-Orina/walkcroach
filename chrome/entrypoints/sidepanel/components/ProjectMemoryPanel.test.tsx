// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectMemoryPanel } from './ProjectMemoryPanel';

vi.mock('../../../lib/sdkClient', () => ({
  listProjectMemory: vi.fn(),
  rememberProjectMemory: vi.fn(),
}));

import {
  listProjectMemory,
  rememberProjectMemory,
} from '../../../lib/sdkClient';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(listProjectMemory).mockResolvedValue({
    entries: [
      {
        id: 'm1',
        kind: 'preference',
        text: 'Prefer concise replies',
        sourceSurface: 'chrome',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ],
  });
  vi.mocked(rememberProjectMemory).mockResolvedValue({
    id: 'm2',
    supersededId: null,
  });
});

describe('ProjectMemoryPanel', () => {
  it('renders nothing when disabled (device session)', () => {
    const { container } = render(
      <ProjectMemoryPanel
        projectId="p1"
        projectName="Acme"
        enabled={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(listProjectMemory).not.toHaveBeenCalled();
  });

  it('lists linked project memory for Cognito sessions', async () => {
    render(
      <ProjectMemoryPanel projectId="p1" projectName="Acme" enabled />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Prefer concise replies/)).toBeTruthy();
    });
    expect(listProjectMemory).toHaveBeenCalledWith('p1');
    expect(screen.getByText(/Shared with “Acme”/)).toBeTruthy();
    expect(screen.getByText(/across WalkCroach/)).toBeTruthy();
    expect(screen.queryByText(/memory API/)).toBeNull();
    expect(screen.getByText(/Preference · Chrome/)).toBeTruthy();
  });

  it('shows a loading skeleton before the first entries arrive', async () => {
    let resolveList!: (value: {
      entries: Array<{
        id: string;
        kind: string;
        text: string;
        sourceSurface: string;
        createdAt: string;
      }>;
    }) => void;
    vi.mocked(listProjectMemory).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    render(
      <ProjectMemoryPanel projectId="p1" projectName="Acme" enabled />,
    );
    expect(screen.getByText(/Loading project memory/)).toBeTruthy();
    resolveList({ entries: [] });
    await waitFor(() => {
      expect(screen.getByText(/No project memories yet/)).toBeTruthy();
    });
  });

  it('surfaces list failures distinctly from empty', async () => {
    vi.mocked(listProjectMemory).mockRejectedValueOnce(
      new Error('missing Cognito access token'),
    );
    render(
      <ProjectMemoryPanel projectId="p1" projectName={null} enabled />,
    );
    await waitFor(() => {
      expect(screen.getByText(/missing Cognito access token/)).toBeTruthy();
    });
    expect(screen.queryByText(/No project memories yet/)).toBeNull();
  });

  it('remembers a note via the SDK', async () => {
    render(
      <ProjectMemoryPanel projectId="p1" projectName="Acme" enabled />,
    );
    await waitFor(() => expect(listProjectMemory).toHaveBeenCalled());
    const input = screen.getByLabelText('Remember a note');
    await userEvent.type(input, 'Ship Friday');
    expect(screen.getByRole('button', { name: 'Remember note' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remember note' }));
    await waitFor(() => {
      expect(rememberProjectMemory).toHaveBeenCalledWith({
        projectId: 'p1',
        kind: 'preference',
        text: 'Ship Friday',
      });
    });
  });
});
