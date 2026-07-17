import { describe, expect, it } from 'vitest';
import { scanBundleContent } from './secret-bundle-scan.mjs';

const ALLOWED = ['https://api.test/proxy/p1', 'wc-session-allowed'];

describe('scanBundleContent', () => {
  it('passes clean proxy-only bundle', () => {
    const js = `
      const PROXY = "${ALLOWED[0]}";
      const TOKEN = "${ALLOWED[1]}";
      fetch(PROXY + "/sql", { headers: { authorization: "Bearer " + TOKEN } });
    `;
    expect(scanBundleContent(js, { allowedValues: ALLOWED })).toEqual([]);
  });

  it('detects stripe live key', () => {
    const findings = scanBundleContent('const k = "sk_live_abcdefgh12345678";', {
      allowedValues: ALLOWED,
    });
    expect(findings.some((f) => f.rule === 'stripe-live-key')).toBe(true);
  });

  it('detects postgres URL with password', () => {
    const findings = scanBundleContent(
      'postgresql://user:secretpass@db.example:26257/app',
      { allowedValues: ALLOWED },
    );
    expect(findings.some((f) => f.rule === 'postgres-url-with-password')).toBe(true);
  });

  it('detects forbidden canary values', () => {
    const findings = scanBundleContent('x', {
      allowedValues: ALLOWED,
      forbiddenCanaries: ['CANARY_NFR13_DB_PASSWORD'],
    });
    expect(findings).toHaveLength(0);

    const leaked = scanBundleContent('value CANARY_NFR13_DB_PASSWORD here', {
      allowedValues: ALLOWED,
      forbiddenCanaries: ['CANARY_NFR13_DB_PASSWORD'],
    });
    expect(leaked.some((f) => f.rule === 'forbidden-canary')).toBe(true);
  });

  it('allows session proxy token when allowlisted', () => {
    const findings = scanBundleContent(`token="${ALLOWED[1]}"`, {
      allowedValues: ALLOWED,
    });
    expect(findings).toEqual([]);
  });
});
