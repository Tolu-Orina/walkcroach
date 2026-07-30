// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PriceHistory, describeHistory, type PricePoint } from './PriceHistory';

afterEach(cleanup);

const at = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString();
const pt = (price: number, day: number): PricePoint => ({
  price,
  currency: 'GBP',
  at: at(day),
});

describe('describeHistory — single point', () => {
  it('invites a return visit on a brand-new track', () => {
    const s = describeHistory({
      points: 1,
      firstAt: at(1),
      currency: 'GBP',
      first: 3.15,
      low: 3.15,
      high: 3.15,
      moved: false,
      delta: 0,
    });
    expect(s).toMatch(/Tracking from/);
    expect(s).toMatch(/Check back/);
  });

  it('says the price has held when the check found no change', () => {
    // History records changes, not visits, so one point plus priceChanged=false
    // means "tracked for a while, never moved" — not "only checked once".
    const s = describeHistory({
      points: 1,
      firstAt: at(1),
      currency: 'GBP',
      first: 3.15,
      low: 3.15,
      high: 3.15,
      moved: false,
      delta: 0,
      priceChanged: false,
    });
    expect(s).toMatch(/No change since you started tracking/);
  });
});

describe('describeHistory — movement', () => {
  it('counts changes, not visits', () => {
    // The old copy said "3 checks", which counted how often the user opened
    // the page rather than how often the price moved.
    const s = describeHistory({
      points: 3,
      firstAt: at(1),
      currency: 'GBP',
      first: 3.15,
      low: 2.5,
      high: 3.15,
      moved: true,
      delta: -0.65,
    });
    expect(s).toMatch(/2 changes since/);
    expect(s).not.toMatch(/checks/);
  });

  it('uses the singular for one change', () => {
    const s = describeHistory({
      points: 2,
      firstAt: at(1),
      currency: 'GBP',
      first: 3.15,
      low: 2.5,
      high: 3.15,
      moved: true,
      delta: -0.65,
    });
    expect(s).toMatch(/1 change since/);
  });

  it('states direction and range', () => {
    const s = describeHistory({
      points: 3,
      firstAt: at(1),
      currency: 'GBP',
      first: 3.15,
      low: 2.5,
      high: 3.4,
      moved: true,
      delta: -0.65,
    });
    expect(s).toMatch(/down from GBP 3\.15/);
    expect(s).toMatch(/range GBP 2\.50–3\.40/);
  });

  it('appends a no-change note when this check found nothing new', () => {
    const s = describeHistory({
      points: 3,
      firstAt: at(1),
      currency: 'GBP',
      first: 3.15,
      low: 2.5,
      high: 3.15,
      moved: true,
      delta: -0.65,
      priceChanged: false,
    });
    expect(s).toMatch(/No change this check\./);
  });

  it('survives an unparseable timestamp instead of printing Invalid Date', () => {
    const s = describeHistory({
      points: 2,
      firstAt: 'not-a-date',
      currency: 'GBP',
      first: 1,
      low: 1,
      high: 2,
      moved: true,
      delta: 1,
    });
    expect(s).toMatch(/an earlier check/);
    expect(s).not.toMatch(/Invalid Date/);
  });
});

describe('PriceHistory', () => {
  it('renders nothing without history', () => {
    const { container } = render(<PriceHistory history={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('leads with the current price', () => {
    render(<PriceHistory history={[pt(3.15, 1)]} />);
    expect(screen.getByText('GBP 3.15')).toBeInTheDocument();
  });

  it('shows no delta on a single point', () => {
    render(<PriceHistory history={[pt(3.15, 1)]} />);
    expect(screen.queryByText(/▼|▲/)).toBeNull();
  });

  it('shows a downward delta against the first recorded price', () => {
    render(<PriceHistory history={[pt(4, 1), pt(3, 2)]} />);
    expect(screen.getByText(/▼ 1\.00 \(25\.0%\)/)).toBeInTheDocument();
  });

  it('shows an upward delta', () => {
    render(<PriceHistory history={[pt(3, 1), pt(4.5, 2)]} />);
    expect(screen.getByText(/▲ 1\.50 \(50\.0%\)/)).toBeInTheDocument();
  });

  it('omits the delta when the price returned to where it began', () => {
    render(<PriceHistory history={[pt(3, 1), pt(4, 2), pt(3, 3)]} />);
    expect(screen.queryByText(/▼|▲/)).toBeNull();
  });

  it('flags the lowest price seen — the reason to track at all', () => {
    render(<PriceHistory history={[pt(4, 1), pt(5, 2), pt(3, 3)]} />);
    expect(screen.getByText(/Lowest price since you started/)).toBeInTheDocument();
  });

  it('does not claim a low when nothing has moved', () => {
    render(<PriceHistory history={[pt(3, 1)]} />);
    expect(screen.queryByText(/Lowest price/)).toBeNull();
  });

  it('sorts out-of-order points before reading first and latest', () => {
    render(<PriceHistory history={[pt(3, 3), pt(5, 1)]} />);
    expect(screen.getByText('GBP 3.00')).toBeInTheDocument();
    expect(screen.getByText(/down from GBP 5\.00/)).toBeInTheDocument();
  });

  it('keeps the chart out of the accessibility tree, with text beside it', () => {
    const { container } = render(<PriceHistory history={[pt(4, 1), pt(3, 2)]} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/down from GBP 4\.00/)).toBeInTheDocument();
  });

  it('is a labelled region', () => {
    render(<PriceHistory history={[pt(3, 1)]} />);
    expect(
      screen.getByRole('region', { name: 'Price history' }),
    ).toBeInTheDocument();
  });
});
