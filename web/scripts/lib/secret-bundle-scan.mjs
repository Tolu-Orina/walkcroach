/**
 * NFR-13 bundle scanning primitives — shared by CI script and unit tests.
 */

export const SECRET_PATTERNS = [
  { name: 'stripe-live-key', re: /sk_live_[A-Za-z0-9]{8,}/ },
  { name: 'stripe-test-key', re: /sk_test_[A-Za-z0-9]{8,}/ },
  { name: 'openai-key', re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'github-pat', re: /ghp_[A-Za-z0-9]{20,}/ },
  { name: 'github-fine-pat', re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/ },
  {
    name: 'postgres-url-with-password',
    re: /postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`]+@/i,
  },
  { name: 'cockroach-url', re: /cockroachdb:\/\/[^\s"'`]+/i },
  { name: 'crdb-url', re: /crdb:\/\/[^\s"'`]+/i },
  {
    name: 'private-key-block',
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  { name: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'nfr13-canary-marker', re: /NFR13_CANARY/ },
];

/**
 * @param {string} content
 * @param {string[]} allowedValues Values permitted in bundle (e.g. session proxy token)
 * @param {string[]} forbiddenCanaries Explicit canary strings that must never appear
 */
export function scanBundleContent(content, { allowedValues = [], forbiddenCanaries = [] } = {}) {
  /** @type {{ file?: string; rule: string; detail: string }[]} */
  const findings = [];
  let scrubbed = content;
  for (const value of allowedValues) {
    scrubbed = scrubbed.split(value).join('');
  }

  for (const canary of forbiddenCanaries) {
    if (scrubbed.includes(canary)) {
      findings.push({
        rule: 'forbidden-canary',
        detail: 'Canary secret value leaked into bundle',
      });
    }
  }

  for (const pattern of SECRET_PATTERNS) {
    const match = scrubbed.match(pattern.re);
    if (match) {
      findings.push({
        rule: pattern.name,
        detail: `Matched ${pattern.name}: ${match[0].slice(0, 24)}…`,
      });
    }
  }

  return findings;
}
