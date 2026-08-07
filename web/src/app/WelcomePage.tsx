import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { markWelcomeComplete } from '../auth/session';
import { useAuth } from '../auth/useAuth';
import { AppShell } from '../components/AppShell';
import { LoadingScreen } from '../components/LoadingScreen';
import { createProject } from '../api/client';
import { peekPendingPrompt, projectNameFromPrompt } from '../lib/pending-prompt';

const STEPS = [
  {
    title: 'Chat is the front door',
    body: 'Ask anything with attachments and search. Projects hold standing context across many chats.',
  },
  {
    title: 'Projects hold memory',
    body: 'Description, documents, and instructions belong to the whole project timeline — not one thread.',
  },
  {
    title: 'Builder is a room',
    body: 'Open App Builder from a project when you want a live preview. Starter templates live there.',
  },
] as const;

export function WelcomePage() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(() => !!peekPendingPrompt());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const pending = peekPendingPrompt();
    if (!pending) return;
    let cancelled = false;
    (async () => {
      setCreating(true);
      setError(null);
      try {
        markWelcomeComplete();
        const { id } = await createProject(
          projectNameFromPrompt(pending.prompt),
          pending.templateId,
        );
        if (!cancelled) {
          navigate(`/app/projects/${id}/builder`, { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setCreating(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (status !== 'authenticated') {
    return <Navigate to="/signin" replace />;
  }

  if (creating && peekPendingPrompt()) {
    return (
      <AppShell>
        <LoadingScreen message="Starting your project…" />
      </AppShell>
    );
  }

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  const finishWelcome = () => {
    markWelcomeComplete();
    navigate('/app/chat', { replace: true });
  };

  return (
    <AppShell>
      <div className="prose-marketing mx-auto flex max-w-2xl flex-col px-4 py-12 sm:px-6">
        <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Welcome</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold text-paper">
          You're in. Memory first, Builder when you need it.
        </h1>

        <div className="glass-strong glass-hairline mt-8 p-6">
          <p className="text-[10px] uppercase tracking-wider text-signal">
            Step {step + 1} of {STEPS.length}
          </p>
          <h2 className="mt-2 font-display text-xl font-bold text-paper">{current.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-mist">{current.body}</p>
          <div className="mt-6 flex justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                markWelcomeComplete();
                navigate('/app/chat');
              }}
              className="btn-ghost text-sm"
            >
              Skip to chat
            </button>
            <button
              type="button"
              onClick={() => (isLast ? finishWelcome() : setStep(step + 1))}
              className="btn-primary text-sm"
            >
              {isLast ? 'Open Chat' : 'Next'}
            </button>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-ember">{error}</p>}
      </div>
    </AppShell>
  );
}
