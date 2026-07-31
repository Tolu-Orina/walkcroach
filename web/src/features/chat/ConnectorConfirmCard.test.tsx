/**
 * @vitest-environment jsdom
 *
 * This card is the human gate in front of every connector write. If a prompt
 * injection on a page persuades the agent to propose `gmail.send`, this render
 * is the last thing standing between that proposal and the user's outbox — so
 * what it shows, and what it refuses to enable, is security behaviour, not
 * presentation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectorConfirmCard } from './ConnectorConfirmCard';

afterEach(cleanup);

type Proposal = Parameters<typeof ConnectorConfirmCard>[0]['pending'];

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    runId: 'run_1',
    action: 'gmail.send',
    title: 'Send email',
    consequence: 'Sends the email. This cannot be undone.',
    write: true,
    irreversible: true,
    weight: 2,
    rows: [
      { label: 'To', value: 'ops@example.com' },
      { label: 'Subject', value: 'Quote for 40 units' },
    ],
    ...over,
  };
}

describe('ConnectorConfirmCard', () => {
  it('shows the consequence and every argument before anything runs', () => {
    render(
      <ConnectorConfirmCard
        pending={proposal()}
        onConfirm={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
    // The recipient must be visible: it is the field an injected instruction
    // would tamper with, and the only place the user can catch it.
    expect(screen.getByText('ops@example.com')).toBeTruthy();
    expect(screen.getByText('Quote for 40 units')).toBeTruthy();
  });

  it('badges an irreversible action', () => {
    render(
      <ConnectorConfirmCard
        pending={proposal()}
        onConfirm={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(screen.getByText('irreversible')).toBeTruthy();
  });

  it('does not badge a reversible write, even though it is a write', () => {
    // Regression: the badge used to key off `write`, so a draft rendered
    // "irreversible" directly above its own text saying nothing is sent.
    // That contradiction is what trains users to click past the badge on
    // the one action where it matters.
    render(
      <ConnectorConfirmCard
        pending={proposal({
          action: 'gmail.draft',
          title: 'Draft email',
          consequence: 'Saves a draft in your mailbox. Nothing is sent.',
          write: true,
          irreversible: false,
        })}
        onConfirm={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(screen.queryByText('irreversible')).toBeNull();
    expect(screen.getByText(/nothing is sent/i)).toBeTruthy();
  });

  it('names the credit cost on the confirm button, so the charge is not a surprise', () => {
    render(
      <ConnectorConfirmCard
        pending={proposal()}
        onConfirm={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /2 credits/ })).toBeTruthy();
  });

  it('says "1 credit", not "1 credits", for a single-credit action', () => {
    render(
      <ConnectorConfirmCard
        pending={proposal({ action: 'calendar.list_events', weight: 1 })}
        onConfirm={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /· 1 credit$/ })).toBeTruthy();
  });

  it('runs only on an explicit click', async () => {
    const onConfirm = vi.fn();
    render(
      <ConnectorConfirmCard
        pending={proposal()}
        onConfirm={onConfirm}
        onDecline={vi.fn()}
      />,
    );
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Confirm/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('declines without executing', async () => {
    const onConfirm = vi.fn();
    const onDecline = vi.fn();
    render(
      <ConnectorConfirmCard
        pending={proposal()}
        onConfirm={onConfirm}
        onDecline={onDecline}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('offers no confirm button when the provider is not connected', () => {
    render(
      <ConnectorConfirmCard
        pending={proposal({
          runId: '',
          needsConnection: 'google',
          connectUrl: 'https://app.example.com/app/settings/connections',
        })}
        onConfirm={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Connections/ })).toBeTruthy();
    // Decline stays available so the card is never a dead end.
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
  });

  it('offers no confirm button without a recorded run id', () => {
    // Without a runId the server has nothing to claim, so a click could only
    // ever fail — or, worse, execute something never written down.
    render(
      <ConnectorConfirmCard
        pending={proposal({ runId: '' })}
        onConfirm={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull();
  });

  it('disables both buttons while executing, so one click cannot become two', async () => {
    const onConfirm = vi.fn();
    render(
      <ConnectorConfirmCard
        pending={proposal()}
        busy
        onConfirm={onConfirm}
        onDecline={vi.fn()}
      />,
    );
    const confirm = screen.getByRole('button', { name: /Executing/ });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Decline' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders argument values as text, never as markup', () => {
    const { container } = render(
      <ConnectorConfirmCard
        pending={proposal({
          rows: [{ label: 'Body', value: '<img src=x onerror=alert(1)>' }],
        })}
        onConfirm={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  });

  it('exposes the card as a labelled region for screen readers', () => {
    render(
      <ConnectorConfirmCard
        pending={proposal()}
        onConfirm={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(screen.getByRole('region', { name: /Confirm connector action/i })).toBeTruthy();
  });
});
