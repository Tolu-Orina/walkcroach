/**
 * Whether a CLI redirect target is acceptable.
 *
 * Must stay in sync with `isLoopbackRedirectUri` in the IDE BFF
 * (`lambda-ide/.../handlers/oauth.ts`) — this check decides what the browser
 * will navigate to, that one decides what the server will mint a code for, and
 * both have to agree or sign-in fails confusingly.
 *
 * Deliberately kept apart from the IDE's `REDIRECT_PATTERN`: widening that
 * regex would touch a path every editor depends on, to serve a case no editor
 * uses. Parsed rather than matched, because `127.0.0.1.attacker.example` is a
 * perfectly good prefix match and a completely different machine.
 */
export function isCliRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:') return false;
  // Literal loopback only. `localhost` goes through DNS and DNS can be moved.
  if (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') return false;
  if (url.pathname !== '/callback') return false;
  if (url.search || url.hash || url.username || url.password) return false;
  if (!url.port) return false;
  const port = Number(url.port);
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}
