/**
 * Built-manifest invariants.
 *
 * These assert the *artifact*, not the source config — the failure mode this
 * catches is a store packet that describes one permission model while the zip
 * ships another (exactly how SUBMISSION_CHECKLIST.md ended up stranded on
 * v0.1.4 while the manifest moved on).
 *
 * Runs after `wxt build`, so it lives outside the pre-build unit suite:
 *   npm run build && npm run test:manifest
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve(import.meta.dirname, '..', '.output', 'chrome-mv3');
const MANIFEST = resolve(OUT_DIR, 'manifest.json');

type Manifest = {
  manifest_version: number;
  version: string;
  permissions?: string[];
  optional_permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
  content_scripts?: unknown[];
  web_accessible_resources?: Array<{ resources: string[]; matches: string[] }>;
  side_panel?: { default_path?: string };
  action?: Record<string, unknown>;
  commands?: Record<string, unknown>;
  key?: string;
};

let manifest: Manifest;

beforeAll(() => {
  if (!existsSync(MANIFEST)) {
    throw new Error(
      `No built manifest at ${MANIFEST}. Run \`npm run build\` before \`npm run test:manifest\`.`,
    );
  }
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as Manifest;
});

describe('permission model (Phase A1)', () => {
  it('is Manifest V3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('never requests broad page access at install time', () => {
    const install = [
      ...(manifest.permissions ?? []),
      ...(manifest.host_permissions ?? []),
    ];
    for (const forbidden of ['<all_urls>', 'http://*/*', 'https://*/*', '*://*/*']) {
      expect(install).not.toContain(forbidden);
    }
  });

  it('does not request the tabs permission', () => {
    // `tabs` would add a "Read your browsing history" install warning. The
    // page-access design deliberately works without it.
    expect(manifest.permissions ?? []).not.toContain('tabs');
  });

  it('offers page access as optional http(s) hosts only', () => {
    expect(manifest.optional_host_permissions).toEqual([
      'http://*/*',
      'https://*/*',
    ]);
  });

  it('declares exactly the permissions the store packet justifies', () => {
    // Keep in lockstep with store/PERMISSION_JUSTIFICATIONS.md — a new entry
    // here without a justification is a review rejection.
    expect([...(manifest.permissions ?? [])].sort()).toEqual([
      'activeTab',
      'contextMenus',
      'identity',
      'scripting',
      'sidePanel',
      'storage',
    ]);
  });

  it('grants install-time host access to exactly one API origin', () => {
    // Length 1 is the assertion that also catches a leaked
    // WALKCROACH_TEST_GRANT_ORIGINS value, which appends extra hosts here.
    const hosts = manifest.host_permissions ?? [];
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatch(/^https?:\/\/[^*]+\/\*$/);
  });

  it('bakes no localhost URL into a production build', () => {
    // Dev builds legitimately point at localhost, so this only binds when the
    // build declared itself production.
    if (process.env.WALKCROACH_REQUIRE_PROD_ENV !== 'true') return;
    expect(readFileSync(MANIFEST, 'utf-8')).not.toMatch(/localhost/);
  });
});

describe('no always-on page injection', () => {
  it('declares no content scripts', () => {
    // The extractor is injected on demand via executeScript({ files }), which
    // is what lets us claim "reads a page only when you click an action".
    expect(manifest.content_scripts ?? []).toEqual([]);
  });

  it('ships the on-demand extractor bundle', () => {
    expect(existsSync(resolve(OUT_DIR, 'extractor.js'))).toBe(true);
  });

  it('keeps the extractor out of web-accessible resources', () => {
    // Page-reachable injection code would defeat the point.
    const exposed = (manifest.web_accessible_resources ?? []).flatMap(
      (entry) => entry.resources,
    );
    expect(exposed).not.toContain('extractor.js');
  });
});

describe('sign-in surface (Phase A4/B1)', () => {
  it('exposes auth.html to the WalkCroach Web origin only', () => {
    const war = manifest.web_accessible_resources ?? [];
    expect(war).toHaveLength(1);
    expect(war[0]!.resources).toEqual(['auth.html']);
    expect(war[0]!.matches).toHaveLength(1);
    // Never <all_urls> / bare wildcard: any site could then navigate to it.
    expect(war[0]!.matches[0]).toMatch(/^https?:\/\/[^*]+\/\*$/);
  });

  it('ships auth.html so the fallback redirect resolves', () => {
    expect(existsSync(resolve(OUT_DIR, 'auth.html'))).toBe(true);
  });

  it('includes identity for launchWebAuthFlow', () => {
    expect(manifest.permissions ?? []).toContain('identity');
  });
});

describe('side panel invocation (gesture ownership)', () => {
  it('registers a side panel and a clickable action', () => {
    expect(manifest.side_panel?.default_path).toBe('sidepanel.html');
    expect(manifest.action).toBeDefined();
  });

  it('has no action popup, so action.onClicked can fire', () => {
    // A default_popup would swallow the click and with it the activeTab grant.
    expect(manifest.action?.default_popup).toBeUndefined();
  });

  it('binds a keyboard shortcut to the action', () => {
    expect(manifest.commands?._execute_action).toBeDefined();
  });
});

describe('release hygiene', () => {
  it('carries a semver version', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('matches package.json', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf-8'),
    ) as { version: string };
    expect(manifest.version).toBe(pkg.version);
  });
});
