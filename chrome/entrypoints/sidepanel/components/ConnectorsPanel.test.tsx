// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectorsPanel } from './ConnectorsPanel';
import type { ConnectorProvider } from '../../../lib/api';

afterEach(cleanup);
const noop = () => undefined;

const gmail = (over: Partial<ConnectorProvider> = {}): ConnectorProvider => ({
  id: 'gmail',
  label: 'Gmail',
  tier: 1,
  disclosure: 'Create drafts and send email as you. WalkCroach cannot read your inbox.',
  scopes: ['https://www.googleapis.com/auth/gmail.compose'],
  connection: null,
  ...over,
});

const connected = {
  id: 'c1',
  provider: 'gmail',
  status: 'connected' as const,
  scopes: ['https://www.googleapis.com/auth/gmail.compose'],
  accountLabel: 'alex@acme.test',
  lastError: null,
  connectedAt: new Date().toISOString(),
};

describe('ConnectorsPanel — states', () => {
  it('asks an anonymous user to sign in, and explains why', () => {
    render(
      <ConnectorsPanel
        providers={[]}
        requiresSignIn
        connectUrl=""
        busyProvider={null}
        onDisconnect={noop}
        onOpenConnect={noop}
      />,
    );
    expect(screen.getByText(/Sign in to connect accounts/)).toBeInTheDocument();
    // The reason matters: connections are account-scoped, not browser-scoped.
    expect(screen.getByText(/not to this browser/)).toBeInTheDocument();
  });

  it('says so plainly when no provider is configured', () => {
    // Providers are hidden until an OAuth app exists; an empty list is expected,
    // not an error.
    render(
      <ConnectorsPanel
        providers={[]}
        requiresSignIn={false}
        connectUrl="https://web.test/x"
        busyProvider={null}
        onDisconnect={noop}
        onOpenConnect={noop}
      />,
    );
    expect(screen.getByText(/No connectors available yet/)).toBeInTheDocument();
  });

  it('shows a disconnected provider without offering Disconnect', () => {
    render(
      <ConnectorsPanel
        providers={[gmail()]}
        requiresSignIn={false}
        connectUrl="https://web.test/x"
        busyProvider={null}
        onDisconnect={noop}
        onOpenConnect={noop}
      />,
    );
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Disconnect Gmail/ })).toBeNull();
  });

  it('names the connected account and discloses the exact scopes', () => {
    render(
      <ConnectorsPanel
        providers={[gmail({ connection: connected })]}
        requiresSignIn={false}
        connectUrl="https://web.test/x"
        busyProvider={null}
        onDisconnect={noop}
        onOpenConnect={noop}
      />,
    );
    expect(screen.getByText('alex@acme.test')).toBeInTheDocument();
    // A user deciding whether to trust this deserves the specifics, not a summary.
    expect(
      screen.getByText('https://www.googleapis.com/auth/gmail.compose'),
    ).toBeInTheDocument();
  });

  it('surfaces a connection error and where to fix it', () => {
    render(
      <ConnectorsPanel
        providers={[
          gmail({
            connection: { ...connected, status: 'error', lastError: 'token expired' },
          }),
        ]}
        requiresSignIn={false}
        connectUrl="https://web.test/x"
        busyProvider={null}
        onDisconnect={noop}
        onOpenConnect={noop}
      />,
    );
    expect(screen.getByText(/token expired/)).toBeInTheDocument();
    expect(screen.getByText(/reconnect in WalkCroach Web/i)).toBeInTheDocument();
  });
});

describe('ConnectorsPanel — actions', () => {
  it('disconnects the named provider', async () => {
    const onDisconnect = vi.fn();
    render(
      <ConnectorsPanel
        providers={[gmail({ connection: connected })]}
        requiresSignIn={false}
        connectUrl="https://web.test/x"
        busyProvider={null}
        onDisconnect={onDisconnect}
        onOpenConnect={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect Gmail' }));
    expect(onDisconnect).toHaveBeenCalledWith('gmail');
  });

  it('locks the button while a disconnect is in flight', () => {
    render(
      <ConnectorsPanel
        providers={[gmail({ connection: connected })]}
        requiresSignIn={false}
        connectUrl="https://web.test/x"
        busyProvider="gmail"
        onDisconnect={noop}
        onOpenConnect={noop}
      />,
    );
    // The accessible name tracks the state too, not just the visible text.
    const btn = screen.getByRole('button', { name: 'Removing Gmail…' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('sends the user to Web to connect, and states the security posture', async () => {
    const onOpenConnect = vi.fn();
    render(
      <ConnectorsPanel
        providers={[gmail()]}
        requiresSignIn={false}
        connectUrl="https://web.test/x"
        busyProvider={null}
        onDisconnect={noop}
        onOpenConnect={onOpenConnect}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: /Connect an account in WalkCroach Web/ }),
    );
    expect(onOpenConnect).toHaveBeenCalledOnce();
    expect(screen.getByText(/never reach this extension/i)).toBeInTheDocument();
  });

  it('hides the connect button when there is nowhere to send the user', () => {
    render(
      <ConnectorsPanel
        providers={[gmail()]}
        requiresSignIn={false}
        connectUrl=""
        busyProvider={null}
        onDisconnect={noop}
        onOpenConnect={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: /Connect an account/ })).toBeNull();
  });
});
