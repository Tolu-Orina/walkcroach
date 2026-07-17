import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { cognitoErrorMessage } from '../../auth/cognito-idp';
import { useAuth } from '../../auth/useAuth';
import { AuthCard, AuthError, AuthLink } from '../../components/auth/AuthCard';

export function SignUpPage() {
  const { status, cognitoEnabled, devAuthAllowed, registerAccount, signIn } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      if (cognitoEnabled) {
        await registerAccount({ email, password, name });
        navigate(`/verify?email=${encodeURIComponent(email.trim())}`);
        return;
      }
      if (devAuthAllowed) {
        signIn(name || email.split('@')[0] || 'Builder');
        navigate('/welcome', { replace: true });
        return;
      }
      setError('Sign-up is not configured for this environment.');
    } catch (err) {
      setError(cognitoErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Create account"
      subtitle="Build apps that remember you — across every session."
      footer={
        <p className="text-sm text-mist">
          Already have an account? <AuthLink to="/signin">Sign in</AuthLink>
        </p>
      }
    >
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <AuthError message={error} />
        <div>
          <label htmlFor="signup-name" className="mb-1 block text-xs text-mist">
            Name
          </label>
          <input
            id="signup-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field"
            placeholder="Optional"
          />
        </div>
        <div>
          <label htmlFor="signup-email" className="mb-1 block text-xs text-mist">
            Email
          </label>
          <input
            id="signup-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
          />
        </div>
        <div>
          <label htmlFor="signup-password" className="mb-1 block text-xs text-mist">
            Password
          </label>
          <input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
          />
          <p className="mt-1 text-[11px] text-mist">
            8+ characters with upper, lower, and a number.
          </p>
        </div>
        <div>
          <label htmlFor="signup-confirm" className="mb-1 block text-xs text-mist">
            Confirm password
          </label>
          <input
            id="signup-confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="field"
          />
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthCard>
  );
}
