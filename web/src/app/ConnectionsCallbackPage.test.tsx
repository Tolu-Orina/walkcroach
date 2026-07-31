/**
 * @vitest-environment jsdom
 *
 * The OAuth landing. It must hand `code`/`state` to the authenticated API
 * exactly once and never treat a provider-side failure as a success — a page
 * that navigated on to Connections regardless would tell the user they had
 * connected an account they had not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ConnectionsCallbackPage } from './ConnectionsCallbackPage';

const completeConnectorOauth = vi.hoisted(() => vi.fn());
vi.mock('../api/client', () => ({ completeConnectorOauth }));

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/app/connections/callback${search}`]}>
      <Routes>
        <Route
          path="/app/connections/callback"
          element={<ConnectionsCallbackPage />}
        />
        <Route
          path="/app/settings/connections"
          element={<div>connections landing</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  completeConnectorOauth.mockReset();
});
afterEach(cleanup);

describe('ConnectionsCallbackPage', () => {
  it('exchanges the code and returns to Connections naming the provider', async () => {
    completeConnectorOauth.mockResolvedValue({ provider: 'google' });
    renderAt('?code=abc123&state=st_1');

    await waitFor(() =>
      expect(screen.getByText('connections landing')).toBeTruthy(),
    );
    expect(completeConnectorOauth).toHaveBeenCalledTimes(1);
    expect(completeConnectorOauth).toHaveBeenCalledWith({
      code: 'abc123',
      state: 'st_1',
    });
  });

  it('reports the provider error and never exchanges', async () => {
    renderAt('?error=access_denied');

    await waitFor(() => expect(screen.getByText(/Connection failed/)).toBeTruthy());
    expect(screen.getByText('access_denied')).toBeTruthy();
    expect(completeConnectorOauth).not.toHaveBeenCalled();
    expect(screen.queryByText('connections landing')).toBeNull();
  });

  it('refuses a callback missing state, which is the CSRF binding', async () => {
    renderAt('?code=abc123');

    await waitFor(() =>
      expect(screen.getByText(/Missing OAuth code or state/)).toBeTruthy(),
    );
    expect(completeConnectorOauth).not.toHaveBeenCalled();
  });

  it('refuses a callback missing the code', async () => {
    renderAt('?state=st_1');

    await waitFor(() =>
      expect(screen.getByText(/Missing OAuth code or state/)).toBeTruthy(),
    );
    expect(completeConnectorOauth).not.toHaveBeenCalled();
  });

  it('surfaces an exchange failure instead of claiming success', async () => {
    completeConnectorOauth.mockRejectedValue(new Error('state expired'));
    renderAt('?code=abc123&state=st_1');

    await waitFor(() => expect(screen.getByText('state expired')).toBeTruthy());
    expect(screen.getByText(/Connection failed/)).toBeTruthy();
    expect(screen.queryByText('connections landing')).toBeNull();
  });

  it('shows a pending state while the exchange is in flight', () => {
    completeConnectorOauth.mockReturnValue(new Promise(() => {}));
    renderAt('?code=abc123&state=st_1');

    expect(screen.getByText(/Finishing connection…/)).toBeTruthy();
  });
});
