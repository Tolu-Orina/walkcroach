process.env.ALLOW_DEV_AUTH ??= 'true';

/**
 * Deliberately does NOT load the repo `.env`.
 *
 * Loading it here makes `hasCrdb()` true, which un-skips every CRDB-gated suite
 * in this module — including ones that reach Bedrock for embeddings. On a
 * machine without AWS credentials (the normal case here: deploys go through
 * gitops) those fail with AccessDenied and the whole suite goes red for reasons
 * unrelated to the code under test.
 *
 * Suites that need a database and nothing else load `.env` themselves; see
 * `api-keys.test.ts`. The broader problem — that DB-backed tests silently skip
 * and read as green — is real but is not this file's to fix.
 */
