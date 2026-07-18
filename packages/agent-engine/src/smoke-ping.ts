/**
 * Live Bedrock smoke (optional). Requires AWS credentials / AWS_BEARER_TOKEN_BEDROCK.
 * Not run in CI unit tests.
 */
import { streamPing } from './bedrock.js';

async function main() {
  process.stdout.write('WalkCroach agent-engine smoke:ping …\n');
  const gen = streamPing({ userText: 'Ping.' });
  let result = await gen.next();
  while (!result.done) {
    const ev = result.value;
    if (ev.type === 'token') process.stdout.write(ev.text);
    if (ev.type === 'usage') {
      process.stdout.write(
        `\n[cache read=${ev.cacheReadInputTokens} write=${ev.cacheWriteInputTokens}]\n`,
      );
    }
    result = await gen.next();
  }
  process.stdout.write(
    `\nOK stopReason=${result.value.stopReason} chars=${result.value.text.length}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
