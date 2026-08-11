import { useEffect, useState } from 'react';

const COACH_KEY = 'wc_coach_seen_v1';

/**
 * One coach mark, once (plan §3.2: "no multi-step tour").
 *
 * It teaches the single thing the permission model needs the user to understand,
 * because it is genuinely non-obvious: nothing leaves the page until they click,
 * and access is per-site and revocable. Getting this across up front is what
 * makes the later in-context Chrome prompt feel expected rather than alarming.
 *
 * Versioned key so a future material change to the model can re-teach it.
 */
export function useCoachMark(): {
  show: boolean;
  dismiss: () => void;
} {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let live = true;
    void chrome.storage.local.get(COACH_KEY).then((data) => {
      if (live && !data[COACH_KEY]) setShow(true);
    });
    return () => {
      live = false;
    };
  }, []);

  return {
    show,
    dismiss: () => {
      setShow(false);
      void chrome.storage.local.set({ [COACH_KEY]: true });
    },
  };
}

export function CoachMark({ onDismiss }: { onDismiss: () => void }) {
  return (
    <aside className="wc-coach" aria-labelledby="wc-coach-title">
      <p className="wc-eyebrow" id="wc-coach-title">
        How this works
      </p>
      <p>
        WalkCroach reads a page only when you click an action — and only on sites
        you allow. You’ll be asked once per site, and you can withdraw any site
        under <strong>Account → Sites</strong> at any time.
      </p>
      <div className="wc-coach__actions">
        <button type="button" className="wc-btn" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </aside>
  );
}
