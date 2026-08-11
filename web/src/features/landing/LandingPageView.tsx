import { useAuth } from '../../auth/useAuth';
import { LoadingScreen } from '../../components/LoadingScreen';
import './landing.css';
import { LandingFooter } from './LandingFooter';
import { LandingHero } from './LandingHero';
import { LandingNav } from './LandingNav';
import { SurfacePairSection } from './SurfacePairSection';
import { SURFACE_PAIRS } from './surfaces';

/**
 * WalkCroach platform landing — Meridian Slate.
 * Primary funnel: memory platform (B). Secondary: coding agents (A).
 * See docs/dual-funnel-messaging.md.
 */
export function LandingPageView() {
  const { status, cognitoEnabled, devAuthAllowed } = useAuth();
  const authenticated = status === 'authenticated';
  const showGuest = !authenticated && (devAuthAllowed || !cognitoEnabled);

  if (status === 'loading') {
    return (
      <div className="landing-meridian flex h-full items-center justify-center">
        <LoadingScreen />
      </div>
    );
  }

  return (
    <div className="landing-meridian flex h-full min-h-0 flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--lp-radius-control)] focus:bg-[var(--lp-accent-bright)] focus:px-3 focus:py-2 focus:text-sm focus:font-bold focus:text-[var(--lp-on-accent)]"
      >
        Skip to content
      </a>
      <LandingNav showGuest={showGuest} authenticated={authenticated} />
      <main id="main" className="min-h-0 flex-1 overflow-y-auto">
        <LandingHero authenticated={authenticated} showGuest={showGuest} />
        {SURFACE_PAIRS.map((pair) => (
          <SurfacePairSection key={pair.id} {...pair} />
        ))}
        <LandingFooter />
      </main>
    </div>
  );
}
