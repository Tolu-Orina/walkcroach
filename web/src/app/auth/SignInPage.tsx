import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { CognitoAuthError, cognitoErrorMessage } from '../../auth/cognito-idp';
import { hasCompletedWelcome } from '../../auth/session';
import { useAuth } from '../../auth/useAuth';
import {
  AuthCard,
  AuthError,
  AuthLink,
  AuthSuccess,
} from '../../components/auth/AuthCard';

export function SignInPage() {
  const { status, cognitoEnabled, devAuthAllowed, loginWithPassword, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verified = params.get('verified') === '1';
  const nextParam = params.get('next');
  const next =
    nextParam && nextParam.startsWith('/')
      ? nextParam
      : hasCompletedWelcome()
        ? '/dashboard'
        : '/welcome';

  if (status === 'authenticated') {
    return <Navigate to={next} replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (cognitoEnabled) {
        await loginWithPassword(email, password);
      } else if (devAuthAllowed) {
        signIn(email.split('@')[0] || 'Builder');
      } else {
        setError('Sign-in is not configured for this environment.');
        return;
      }
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof CognitoAuthError && err.code === 'UserNotConfirmedException') {
        navigate(`/verify?email=${encodeURIComponent(email.trim())}`);
        return;
      }
      setError(cognitoErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back. Your projects and memory are waiting."
      footer={
        <p className="text-sm text-mist">
          New here? <AuthLink to="/signup">Create an account</AuthLink>
        </p>
      }
    >
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <AuthSuccess message={verified ? 'Email verified — you can sign in now.' : null} />
        <AuthError message={error} />
        <div>
          <label htmlFor="signin-email" className="mb-1 block text-xs text-mist">
            Email
          </label>
          <input
            id="signin-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="signin-password" className="text-xs text-mist">
              Password
            </label>
            <AuthLink to="/forgot-password">Forgot password?</AuthLink>
          </div>
          <input
            id="signin-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
          />
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {!cognitoEnabled && devAuthAllowed && (
        <p className="mt-4 text-center text-xs text-mist">
          Dev mode — or{' '}
          <Link to="/try" className="interactive text-signal hover:underline">
            try as guest
          </Link>
        </p>
      )}
    </AuthCard>
  );
}
