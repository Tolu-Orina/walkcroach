/**
 * @vitest-environment jsdom
 *
 * Settings → Connections (Phase F2). This is where a user grants and withdraws
 * an OAuth account, so the two states it must never blur are "connected" and
 * "not connected" — and a withdrawal has to be reflected from the server, not
 * assumed locally.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ConnectionsPage } from './ConnectionsPage';

const listConnectors = vi.hoisted(() => vi.fn());
const startConnectorOauth = vi.hoisted(() => vi.fn());
const disconnectConnector = vi.hoisted(() => vi.fn());
vi.mock('../api/client', () => ({
  listConnectors,
  startConnectorOauth,
  disconnectConnector,
}));

const assign = vi.fn();

type Provider = {
  id: string;
  label: string;
  tier: number;
  disclosure: string;
  connectable?: boolean;
  comingSoon?: string | null;
  connection?: {
    status: string;
    accountLabel?: string;
    lastError?: string;
  } | null;
};

function google(over: Partial<Provider> = {}): Provider {
  return {
    id: 'google',
    label: 'Google',
    tier: 1,
    disclosure: 'Calendar, Gmail and Sheets on your behalf.',
    connection: null,
    ...over,
  };
}

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/app/settings/connections${search}`]}>
      <ConnectionsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listConnectors.mockReset().mockResolvedValue({ providers: [] });
  startConnectorOauth.mockReset();
  disconnectConnector.mockReset();
  assign.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign },
  });
});
afterEach(cleanup);

describe('ConnectionsPage', () => {
  it('explains where tokens live, since that is the trust claim', async () => {
    renderPage();
    expect(
      await screen.findByText(/Tokens stay\s+in Secrets Manager — never in the browser\./),
    ).toBeTruthy();
  });

  it('says nothing is configured rather than showing an empty list', async () => {
    renderPage();
    expect(
      await screen.findByText(/No OAuth apps configured yet/),
    ).toBeTruthy();
  });

  it('offers Connect for a provider with no connection', async () => {
    listConnectors.mockResolvedValue({ providers: [google()] });
    renderPage();

    expect(await screen.findByRole('button', { name: 'Connect' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(screen.queryByText('connected')).toBeNull();
    expect(screen.getByText('Calendar, Gmail and Sheets on your behalf.')).toBeTruthy();
  });

  it('shows the connected account and offers Disconnect', async () => {
    listConnectors.mockResolvedValue({
      providers: [
        google({
          connection: { status: 'connected', accountLabel: 'owner@acme.co' },
        }),
      ],
    });
    renderPage();

    expect(await screen.findByText('connected')).toBeTruthy();
    expect(screen.getByText('owner@acme.co')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
  });

  it('treats a revoked connection as not connected', async () => {
    // A revoked token still has a row. If the page read "has a connection" as
    // "connected", it would offer Disconnect for an account that already
    // cannot be used, and hide the Connect that actually fixes it.
    listConnectors.mockResolvedValue({
      providers: [google({ connection: { status: 'revoked' } })],
    });
    renderPage();

    expect(await screen.findByRole('button', { name: 'Connect' })).toBeTruthy();
    expect(screen.queryByText('connected')).toBeNull();
  });

  it('sends the user to the provider-issued authorize URL', async () => {
    listConnectors.mockResolvedValue({ providers: [google()] });
    startConnectorOauth.mockResolvedValue({
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=st_1',
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(startConnectorOauth).toHaveBeenCalledWith('google');
    expect(assign).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/v2/auth?state=st_1',
    );
  });

  it('surfaces a failed authorize start and re-enables the button', async () => {
    listConnectors.mockResolvedValue({ providers: [google()] });
    startConnectorOauth.mockRejectedValue(new Error('google is not configured'));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('google is not configured')).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  });

  it('re-reads from the server after disconnecting, rather than assuming', async () => {
    listConnectors
      .mockResolvedValueOnce({
        providers: [google({ connection: { status: 'connected' } })],
      })
      .mockResolvedValueOnce({ providers: [google()] });
    disconnectConnector.mockResolvedValue({});
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(disconnectConnector).toHaveBeenCalledWith('google');
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeTruthy();
    expect(listConnectors).toHaveBeenCalledTimes(2);
  });

  it('keeps showing the connection when disconnect fails', async () => {
    listConnectors.mockResolvedValue({
      providers: [google({ connection: { status: 'connected' } })],
    });
    disconnectConnector.mockRejectedValue(new Error('revoke failed upstream'));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText('revoke failed upstream')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('confirms the provider named in the callback redirect', async () => {
    listConnectors.mockResolvedValue({
      providers: [google({ connection: { status: 'connected' } })],
    });
    renderPage('?connected=google');
    expect(await screen.findByText('Connected google.')).toBeTruthy();
  });

  it('reports a listing failure instead of an empty page', async () => {
    listConnectors.mockRejectedValue(new Error('session expired'));
    renderPage();
    expect(await screen.findByText('session expired')).toBeTruthy();
  });

  it('shows a stored connection error so a silently dead token is visible', async () => {
    listConnectors.mockResolvedValue({
      providers: [
        google({
          connection: { status: 'connected', lastError: 'token refresh rejected' },
        }),
      ],
    });
    renderPage();
    expect(await screen.findByText('token refresh rejected')).toBeTruthy();
  });
});

describe('announced but unshipped providers', () => {
  function hubspot(): Provider {
    return {
      id: 'hubspot',
      label: 'HubSpot',
      tier: 2,
      disclosure: 'Contacts and deals on your behalf.',
      connectable: false,
      comingSoon: 'HubSpot requires their new Projects app framework.',
      connection: null,
    };
  }

  it('shows the provider with its reason rather than hiding it', async () => {
    listConnectors.mockResolvedValue({ providers: [hubspot()] });
    renderPage();

    expect(await screen.findByText('HubSpot')).toBeTruthy();
    expect(
      screen.getByText('HubSpot requires their new Projects app framework.'),
    ).toBeTruthy();
    expect(screen.getByText('coming soon')).toBeTruthy();
  });

  it('offers no way to start a flow that would dead-end', async () => {
    listConnectors.mockResolvedValue({ providers: [hubspot()] });
    renderPage();

    const button = await screen.findByRole('button', { name: /coming soon/i });
    expect(button.hasAttribute('disabled')).toBe(true);
    await userEvent.click(button);
    expect(startConnectorOauth).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
  });

  it('still connects providers that have shipped, in the same list', async () => {
    listConnectors.mockResolvedValue({
      providers: [hubspot(), google({ connectable: true })],
    });
    startConnectorOauth.mockResolvedValue({ authorizeUrl: 'https://example.test/a' });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(startConnectorOauth).toHaveBeenCalledWith('google');
  });

  it('treats a provider from a Lambda predating the field as connectable', async () => {
    // Old response shape: no `connectable`, no `comingSoon`. Must behave
    // exactly as it did before, not silently become unconnectable.
    listConnectors.mockResolvedValue({ providers: [google()] });
    renderPage();

    expect(await screen.findByRole('button', { name: 'Connect' })).toBeTruthy();
    expect(screen.queryByText('coming soon')).toBeNull();
  });
});
