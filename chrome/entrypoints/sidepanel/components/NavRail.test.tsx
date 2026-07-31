// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavRail } from './NavRail';

afterEach(cleanup);

/**
 * The rail is the panel's only navigation, and it is implemented as an ARIA
 * tablist with roving tabindex. Both are easy to get subtly wrong in a way that
 * looks fine on screen and strands a keyboard user, so they are pinned here.
 */

describe('NavRail — semantics', () => {
  it('is a labelled tablist with one tab per section', () => {
    render(<NavRail active="page" onSelect={() => undefined} />);
    expect(
      screen.getByRole('tablist', { name: 'WalkCroach sections' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });

  it('marks exactly one tab selected', () => {
    render(<NavRail active="recall" onSelect={() => undefined} />);
    const selected = screen
      .getAllByRole('tab')
      .filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAccessibleName(/Recall/);
  });

  it('points each tab at the pane it controls', () => {
    render(<NavRail active="page" onSelect={() => undefined} />);
    expect(screen.getByRole('tab', { name: /Page/ })).toHaveAttribute(
      'aria-controls',
      'wc-pane-page',
    );
  });
});

describe('NavRail — roving tabindex', () => {
  it('puts only the active tab in the tab order', () => {
    // Without this a keyboard user tabs through all four before reaching the
    // content, which is exactly what the tablist pattern exists to avoid.
    render(<NavRail active="saved" onSelect={() => undefined} />);
    const tabs = screen.getAllByRole('tab');
    const reachable = tabs.filter((t) => t.getAttribute('tabindex') === '0');
    expect(reachable).toHaveLength(1);
    expect(reachable[0]).toHaveAccessibleName(/Saved/);
  });

  it('moves forward with ArrowRight and ArrowDown', async () => {
    const onSelect = vi.fn();
    render(<NavRail active="page" onSelect={onSelect} />);
    const active = screen.getByRole('tab', { name: /Page/ });
    active.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onSelect).toHaveBeenLastCalledWith('recall');
    await userEvent.keyboard('{ArrowDown}');
    expect(onSelect).toHaveBeenLastCalledWith('recall');
  });

  it('moves backward with ArrowLeft and ArrowUp', async () => {
    const onSelect = vi.fn();
    render(<NavRail active="recall" onSelect={onSelect} />);
    screen.getByRole('tab', { name: /Recall/ }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onSelect).toHaveBeenLastCalledWith('page');
  });

  it('wraps at both ends rather than dead-ending', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<NavRail active="page" onSelect={onSelect} />);
    screen.getByRole('tab', { name: /Page/ }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onSelect).toHaveBeenLastCalledWith('account');

    rerender(<NavRail active="account" onSelect={onSelect} />);
    screen.getByRole('tab', { name: /Account/ }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onSelect).toHaveBeenLastCalledWith('page');
  });

  it('selects on click', async () => {
    const onSelect = vi.fn();
    render(<NavRail active="page" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('tab', { name: /Account/ }));
    expect(onSelect).toHaveBeenCalledWith('account');
  });

  it('ignores keys that are not navigation', async () => {
    const onSelect = vi.fn();
    render(<NavRail active="page" onSelect={onSelect} />);
    screen.getByRole('tab', { name: /Page/ }).focus();
    await userEvent.keyboard('{End}');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
