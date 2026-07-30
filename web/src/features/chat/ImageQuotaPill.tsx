import { useEffect, useState } from 'react';
import { getCreativeQuota, type CreativeQuota } from '../../api/client';

/**
 * Rolling daily image-generation cap pill for Chat (web plan Phase A6).
 * Hard cap applies to every owner; paid users also spend 5 credits/image.
 */
export function ImageQuotaPill() {
  const [quota, setQuota] = useState<CreativeQuota | null>(null);

  useEffect(() => {
    const load = () => {
      void getCreativeQuota()
        .then(setQuota)
        .catch(() => setQuota(null));
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!quota) return null;

  const { remaining, limit } = quota.image;
  const tone =
    remaining === 0
      ? 'border-red-400/40 bg-red-400/10 text-red-300'
      : remaining === 1
        ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
        : 'border-signal/30 bg-signal/10 text-signal';

  return (
    <div
      className={`interactive flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] ${tone}`}
      title={`Image generations reset within 24 hours. ${quota.plan === 'paid' ? 'Paid plan: 5 credits per image.' : 'Free plan.'}`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      <span>
        images {remaining}/{limit}
      </span>
    </div>
  );
}
