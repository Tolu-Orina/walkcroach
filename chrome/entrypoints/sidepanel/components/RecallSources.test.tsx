// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RecallSources, formatWhen, labelType } from './RecallSources';
import type { RecallSource } from '../../../lib/api';

afterEach(cleanup);

const src = (over: Partial<RecallSource> = {}): RecallSource => ({
  captureId: 'c1',
  url: 'https://northwind.test/q/4471',
  title: 'Supplier quote Q-4471',
  captureType: 'general',
  workspace: 'Suppliers',
  inWebProject: false,
  capturedAt: new Date().toISOString(),
  distance: 0.12,
  ...over,
});

describe('labelType', () => {
  it('translates storage keys into user-facing words', () => {
    expect(labelType('candidate')).toBe('candidate');
    expect(labelType('selection')).toBe('highlight');
    expect(labelType('price')).toBe('price');
  });

  it('falls back to "page" for anything unrecognised', () => {
    expect(labelType('general')).toBe('page');
    expect(labelType('something-new')).toBe('page');
  });
});

describe('formatWhen', () => {
  const now = Date.UTC(2026, 5, 15);
  it('is relative while that is still useful', () => {
    expect(formatWhen(new Date(now).toISOString(), now)).toBe('today');
    expect(formatWhen(new Date(now - 86_400_000).toISOString(), now)).toBe('yesterday');
    expect(formatWhen(new Date(now - 5 * 86_400_000).toISOString(), now)).toBe('5d ago');
  });

  it('switches to a date once "N days ago" stops meaning anything', () => {
    const out = formatWhen(new Date(now - 90 * 86_400_000).toISOString(), now);
    expect(out).not.toMatch(/ago/);
    expect(out).toMatch(/\d/);
  });

  it('returns empty rather than "Invalid Date"', () => {
    expect(formatWhen('nonsense', now)).toBe('');
  });
});

describe('RecallSources', () => {
  it('renders nothing when the answer cited nothing', () => {
    const { container } = render(<RecallSources sources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('numbers sources to match the [n] markers in the answer', () => {
    render(<RecallSources sources={[src(), src({ captureId: 'c2' })]} />);
    const list = screen.getByRole('list');
    expect(list.textContent).toContain('1');
    expect(list.textContent).toContain('2');
  });

  it('counts the captures the answer was built from', () => {
    render(<RecallSources sources={[src(), src({ captureId: 'c2' })]} />);
    expect(screen.getByText(/Answered from 2 captures/)).toBeInTheDocument();
  });

  it('uses the singular for one capture', () => {
    render(<RecallSources sources={[src()]} />);
    expect(screen.getByText(/Answered from 1 capture/)).toBeInTheDocument();
  });

  it('links each source to the page it came from', () => {
    render(<RecallSources sources={[src()]} />);
    const link = screen.getByRole('link', { name: 'Supplier quote Q-4471' });
    expect(link).toHaveAttribute('href', 'https://northwind.test/q/4471');
    expect(link).toHaveAttribute('target', '_blank');
    // Untrusted third-party URL: never hand it a window opener.
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('falls back to the URL when a capture has no title', () => {
    render(<RecallSources sources={[src({ title: null })]} />);
    expect(
      screen.getByRole('link', { name: 'https://northwind.test/q/4471' }),
    ).toBeInTheDocument();
  });

  it('shows capture type and workspace', () => {
    render(<RecallSources sources={[src({ captureType: 'candidate' })]} />);
    expect(screen.getByText('candidate')).toBeInTheDocument();
    expect(screen.getByText('Suppliers')).toBeInTheDocument();
  });

  it('marks a capture mirrored into a linked Web project', () => {
    // The cross-surface memory promise, made concrete per capture.
    render(<RecallSources sources={[src({ inWebProject: true })]} />);
    expect(screen.getByText('also in Web')).toBeInTheDocument();
  });

  it('says nothing about Web when the workspace is not linked', () => {
    render(<RecallSources sources={[src({ inWebProject: false })]} />);
    expect(screen.queryByText('also in Web')).toBeNull();
  });

  it('does not render the raw distance score', () => {
    render(<RecallSources sources={[src({ distance: 0.1234 })]} />);
    expect(screen.queryByText(/0\.12/)).toBeNull();
  });
});
