// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreditMeter } from './CreditMeter';

afterEach(cleanup);

describe('CreditMeter', () => {
  it('renders nothing without balance or error', () => {
    const { container } = render(<CreditMeter credits={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the shared pool meter', () => {
    render(
      <CreditMeter
        credits={{ remaining: 12, allowance: 50, plan: 'free' }}
      />,
    );
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '12');
    expect(screen.getByText(/Shared with WalkCroach Web/)).toBeTruthy();
    expect(screen.queryByText('Running low')).toBeNull();
    expect(screen.queryByText('Out of credits')).toBeNull();
  });

  it('names low and spent states in text, not only bar color', () => {
    const { rerender } = render(
      <CreditMeter credits={{ remaining: 2, allowance: 50 }} />,
    );
    expect(screen.getByText('Running low')).toBeTruthy();
    expect(screen.getByRole('meter')).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/running low/i),
    );

    rerender(<CreditMeter credits={{ remaining: 0, allowance: 50 }} />);
    expect(screen.getByText(/Out of credits/)).toBeTruthy();
    expect(screen.getByRole('meter')).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/out of credits/i),
    );
  });

  it('surfaces fetch errors with retry instead of disappearing', async () => {
    const onRetry = vi.fn();
    render(
      <CreditMeter
        credits={null}
        error="Could not load credits (503)."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/503/);
    await userEvent.click(
      screen.getByRole('button', { name: 'Retry loading credits' }),
    );
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
