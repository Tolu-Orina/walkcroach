import type { StoredSession } from '../../../lib/auth';

/**
 * Brand test (WalkCroach frontend rules): remove the nav chrome and the first
 * viewport must still read as WalkCroach. The wordmark is display-weight and the
 * largest text in the panel — an eyebrow-sized logo above a generic "AI
 * Assistant" heading is exactly the failure this guards against.
 *
 * The amber period is the only decorative use of the signal colour; everything
 * else amber is a call to action.
 */
export function BrandHeader({
  session,
  onAccountClick,
}: {
  session: StoredSession | null;
  onAccountClick: () => void;
}) {
  const signedIn = session?.source === 'cognito';
  return (
    <header className="wc-brandbar">
      <h1 className="wc-wordmark">
        WalkCroach<span className="wc-wordmark-dot">.</span>
      </h1>
      <AccountChip signedIn={signedIn} onClick={onAccountClick} />
    </header>
  );
}

function AccountChip({
  signedIn,
  onClick,
}: {
  signedIn: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="wc-chip"
      onClick={onClick}
      aria-label={
        signedIn
          ? 'Signed in. Open account and sites'
          : 'Using a device session. Open account and sites to sign in'
      }
      title={signedIn ? 'Signed in' : 'Device session — not signed in'}
    >
      <span
        className={
          signedIn ? 'wc-chip__dot wc-chip__dot--signed-in' : 'wc-chip__dot'
        }
      />
      <span className="wc-chip__label">
        {signedIn ? 'Signed in' : 'Device'}
      </span>
    </button>
  );
}
