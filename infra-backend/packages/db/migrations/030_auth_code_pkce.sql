-- PKCE (RFC 7636) for the WalkCroach-issued authorization codes.
--
-- WHY
-- `ide_auth_codes` (IDE + CLI) and `chrome_auth_codes` (extension) hold one-time
-- codes exchanged for Cognito tokens at a PUBLIC endpoint — POST /ide/v1/oauth/token
-- and its Chrome twin. Until now the exchange proved only that the caller knew the
-- code, the state and the redirect URI, all of which travel together in the callback
-- URL. On the IDE that URL is a custom scheme handled by the OS; on the CLI it is a
-- loopback port. Both are local channels another process on the machine can
-- plausibly observe or race for.
--
-- With a challenge recorded here, the exchange additionally requires the verifier —
-- which never leaves the client process and never appears in any URL. A code seen in
-- transit stops being a session.
--
-- NULLABILITY
-- Deliberately nullable at the schema level, mandatory in the handler.
--   * A NOT NULL column would fail against any code row already in flight.
--   * Enforcing in the handler returns a clear 400 / invalid_grant instead of a
--     constraint violation surfacing as a 500.
-- No client has shipped yet, so there is no tolerate-if-absent transition: the
-- handlers reject a missing challenge outright from the first deploy. If that ever
-- changes, the check to relax is in the handler, not here.
--
-- code_challenge_method is stored rather than assumed so that a future method can be
-- added without guessing how existing rows were derived. Only 'S256' is accepted;
-- 'plain' is refused at the handler because under it the challenge IS the verifier,
-- which would hand proof-of-possession to anyone who saw the authorize URL.

ALTER TABLE ide_auth_codes
  ADD COLUMN IF NOT EXISTS code_challenge STRING;
ALTER TABLE ide_auth_codes
  ADD COLUMN IF NOT EXISTS code_challenge_method STRING;

ALTER TABLE chrome_auth_codes
  ADD COLUMN IF NOT EXISTS code_challenge STRING;
ALTER TABLE chrome_auth_codes
  ADD COLUMN IF NOT EXISTS code_challenge_method STRING;
