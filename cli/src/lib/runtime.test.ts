/**
 * Colour and interactivity gating (C0.6).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  colorEnabled,
  inputAllowed,
  resetRuntimeFlags,
  setRuntimeFlags,
} from './runtime.js';

const tty = { isTTY: true };
const piped = { isTTY: false };

afterEach(resetRuntimeFlags);

describe('colorEnabled', () => {
  it('colours an interactive terminal', () => {
    expect(colorEnabled(tty, {})).toBe(true);
  });

  it('stays plain when the stream is piped', () => {
    expect(colorEnabled(piped, {})).toBe(false);
  });

  it('honours NO_COLOR, including when set to empty', () => {
    // no-color.org: presence is the signal, whatever the value.
    expect(colorEnabled(tty, { NO_COLOR: '1' })).toBe(false);
    expect(colorEnabled(tty, { NO_COLOR: '' })).toBe(false);
  });

  it('stays plain on a dumb terminal', () => {
    expect(colorEnabled(tty, { TERM: 'dumb' })).toBe(false);
  });

  it('lets FORCE_COLOR override a piped stream', () => {
    expect(colorEnabled(piped, { FORCE_COLOR: '1' })).toBe(true);
    expect(colorEnabled(piped, { FORCE_COLOR: '0' })).toBe(false);
  });

  it('lets --no-color beat FORCE_COLOR', () => {
    // The flag is more current than the inherited environment.
    setRuntimeFlags({ noColor: true });
    expect(colorEnabled(tty, { FORCE_COLOR: '1' })).toBe(false);
  });
});

describe('inputAllowed', () => {
  it('allows prompting on a TTY', () => {
    expect(inputAllowed(tty)).toBe(true);
  });

  it('refuses when stdin is piped', () => {
    expect(inputAllowed(piped)).toBe(false);
  });

  it('refuses when --no-input is passed, TTY or not', () => {
    setRuntimeFlags({ noInput: true });
    expect(inputAllowed(tty)).toBe(false);
  });
});
