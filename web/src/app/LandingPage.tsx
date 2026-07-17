import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createProject } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { AppShell } from '../components/AppShell';
import { LoadingScreen } from '../components/LoadingScreen';
import { FeatureGrid } from '../features/landing/FeatureGrid';
import { LandingFooter } from '../features/landing/LandingFooter';
import { LandingHero } from '../features/landing/LandingHero';
import { MemoryRecallDemo } from '../features/landing/MemoryRecallDemo';
import { SocialProof } from '../features/landing/SocialProof';
import {
  inferTemplateFromPrompt,
  projectNameFromPrompt,
  setPendingPrompt,
} from '../lib/pending-prompt';

export function LandingPage() {
  const { status, signIn, signInAnonymous, cognitoEnabled, devAuthAllowed } = useAuth();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAuthenticated = status === 'authenticated';

  if (status === 'loading') {
    return (
      <AppShell marketing>
        <LoadingScreen />
      </AppShell>
    );
  }

  const handleDevStart = () => {
    signIn();
    navigate('/welcome');
  };

  const handleTryGuest = () => {
    signInAnonymous();
    navigate('/try');
  };

  const handleStartPrompt = async (prompt: string) => {
    if (starting) return;
    setStarting(true);
    setError(null);
    const templateId = inferTemplateFromPrompt(prompt);
    setPendingPrompt(prompt, templateId);

    try {
      if (isAuthenticated) {
        const { id } = await createProject(projectNameFromPrompt(prompt), templateId);
        navigate(`/project/${id}`);
        return;
      }

      if (devAuthAllowed) {
        signInAnonymous();
        navigate('/try');
        return;
      }

      if (cognitoEnabled) {
        navigate('/signup');
        return;
      }

      signIn();
      navigate('/welcome');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  };

  return (
    <AppShell marketing>
      <div className="prose-marketing flex min-h-0 flex-1 flex-col">
        <LandingHero
          onStartPrompt={handleStartPrompt}
          busy={starting}
          authenticated={isAuthenticated}
          cognitoEnabled={cognitoEnabled}
          devAuthAllowed={devAuthAllowed}
          onDevStart={handleDevStart}
          onTryGuest={handleTryGuest}
        />
        <SocialProof />
        <MemoryRecallDemo />
        <FeatureGrid />
        {error && (
          <p className="px-6 pb-4 text-center text-sm text-ember lg:px-10">{error}</p>
        )}
        {!isAuthenticated && (
          <p className="px-6 pb-6 text-center text-[11px] text-mist lg:px-10">
            {devAuthAllowed
              ? 'Guest sessions are capped and not saved to your dashboard. Sign in to keep projects.'
              : 'Create an account to save projects, sync to GitHub, and deploy to your subdomain.'}
          </p>
        )}
        <LandingFooter />
      </div>
    </AppShell>
  );
}
