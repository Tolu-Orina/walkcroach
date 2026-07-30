// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccessNotice } from './AccessNotice';
import type { PageAccess } from '../../../lib/page-access';

afterEach(cleanup);

const noop = () => undefined;

const ready: PageAccess = {
  status: 'ready',
  tabId: 1,
  url: 'https://acme.test/quote',
  title: 'Quote',
  origin: 'https://acme.test/*',
};
const needsGrant: PageAccess = { ...ready, status: 'needs-grant' };
const restricted: PageAccess = {
  status: 'restricted',
  tabId: 1,
  url: 'chrome://settings',
  reason: 'scheme',
};
const unknown: PageAccess = { status: 'unknown', tabId: 1 };

describe('AccessNotice — the permission gate', () => {
  it('stays out of the way once the page is readable', () => {
    const { container } = render(
      <AccessNotice access={ready} onGrant={noop} onRecheck={noop} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before the tab has been classified', () => {
    const { container } = render(
      <AccessNotice access={null} onGrant={noop} onRecheck={noop} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('offers a grant naming the exact site, and requests it on click', async () => {
    const onGrant = vi.fn();
    render(
      <AccessNotice access={needsGrant} onGrant={onGrant} onRecheck={noop} />,
    );
    const button = screen.getByRole('button', { name: 'Allow on acme.test' });
    await userEvent.click(button);
    expect(onGrant).toHaveBeenCalledOnce();
  });

  it('gives a restricted page no action to click', () => {
    render(
      <AccessNotice access={restricted} onGrant={noop} onRecheck={noop} />,
    );
    // No grant could ever make chrome:// readable, so offering one would lie.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/browser pages/i);
  });

  it('offers a re-check when one toolbar click would resolve it', async () => {
    const onRecheck = vi.fn();
    render(
      <AccessNotice access={unknown} onGrant={noop} onRecheck={onRecheck} />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: /I clicked it/i }),
    );
    expect(onRecheck).toHaveBeenCalledOnce();
  });

  it('announces itself, because access can change without the user touching the panel', () => {
    render(
      <AccessNotice access={needsGrant} onGrant={noop} onRecheck={noop} />,
    );
    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
  });

  it('never offers a grant button for a state a grant cannot fix', () => {
    for (const access of [restricted, unknown, { status: 'no-tab' } as PageAccess]) {
      cleanup();
      render(<AccessNotice access={access} onGrant={noop} onRecheck={noop} />);
      expect(screen.queryByRole('button', { name: /^Allow on/ })).toBeNull();
    }
  });
});
