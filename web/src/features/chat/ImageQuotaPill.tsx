import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCreativeQuota, type CreativeQuota } from '../../api/client';

/**
 * Rolling creative hard-cap pills (images /24h · video /72h) + upgrade affordance.
 */
export function ImageQuotaPill() {
  const [quota, setQuota] = useState<CreativeQuota | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => {
      void getCreativeQuota()
        .then((q) => {
          setQuota(q);
          setError(null);
        })
        .catch((err: unknown) => {
          setQuota(null);
          setError(err instanceof Error ? err.message : 'Quota unavailable');
        })
        .finally(() => setLoading(false));
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (loading && !quota && !error) {
    return (
      <div
        className="rounded-full border border-line/60 px-2.5 py-1 font-mono text-[11px] text-mist/70"
        aria-busy="true"
      >
        quota…
      </div>
    );
  }

  if (error && !quota) {
    return (
      <button
        type="button"
        className="interactive rounded-full border border-ember/35 bg-ember/10 px-2.5 py-1 font-mono text-[11px] text-ember"
        title={error}
        onClick={() => {
          setLoading(true);
          setError(null);
          void getCreativeQuota()
            .then((q) => {
              setQuota(q);
              setError(null);
            })
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : 'Quota unavailable');
            })
            .finally(() => setLoading(false));
        }}
      >
        quota unavailable · retry
      </button>
    );
  }

  if (!quota) return null;

  const { remaining, limit } = quota.image;
  const tone =
    remaining === 0
      ? 'border-red-400/40 bg-red-400/10 text-red-300'
      : remaining === 1
        ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
        : 'border-signal/30 bg-signal/10 text-signal';

  const videoRemaining = quota.video.remaining ?? quota.video.limit;
  const videoTone =
    videoRemaining === 0
      ? 'border-red-400/40 bg-red-400/10 text-red-300'
      : 'border-signal/30 bg-signal/10 text-signal';

  const hasCreatives =
    quota.plan === 'starter' || quota.plan === 'pro' || quota.plan === 'paid';
  const hasVideo = quota.plan === 'pro' || quota.plan === 'paid';
  const videoTitle =
    videoRemaining === 0
      ? `Video resets around ${quota.video.resetAt ?? '—'}`
      : hasVideo
        ? '1× ≤30s video per rolling 72 hours (Pro)'
        : 'Video requires Pro';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className={`interactive flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] ${tone}`}
        title={
          hasCreatives
            ? 'Starter/Pro: 5 credits per image · ≤3 / 24h'
            : 'Images require Starter or Pro'
        }
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
        <span>
          images {remaining}/{limit}
        </span>
      </div>
      <div
        className={`interactive flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] ${videoTone}`}
        title={videoTitle}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
        <span>
          {!hasVideo
            ? 'video locked'
            : videoRemaining === 0
              ? 'video locked'
              : `video ${videoRemaining}/${quota.video.limit}`}
        </span>
      </div>
      {!hasCreatives && (
        <Link
          to="/app/settings"
          className="interactive rounded-full border border-signal/40 bg-signal/10 px-2.5 py-1 font-mono text-[11px] text-signal hover:bg-signal/20"
        >
          upgrade
        </Link>
      )}
      {hasCreatives && !hasVideo && (
        <Link
          to="/app/settings"
          className="interactive rounded-full border border-signal/40 bg-signal/10 px-2.5 py-1 font-mono text-[11px] text-signal hover:bg-signal/20"
        >
          unlock video
        </Link>
      )}
    </div>
  );
}
