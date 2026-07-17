import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { cognitoErrorMessage } from '../../auth/cognito-idp';
import { useAuth } from '../../auth/useAuth';
import { AuthCard, AuthError, AuthLink } from '../../components/auth/AuthCard';

export function ResetPasswordPage() {
  const { cognitoEnabled, confirmPasswordReset } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const email = params.get('email') ?? '';
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!cognitoEnabled) {
    return <Navigate to="/signin" replace />;
  }

  if (!email) {
    return <Navigate to="/forgot-password" replace />;
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
      await confirmPasswordReset(email, code, password);
      navigate('/signin', { replace: true });
    } catch (err) {
      setError(cognitoErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Reset password"
      subtitle={`Enter the code sent to ${email}.`}
      footer={
        <p className="text-sm text-mist">
          <AuthLink to="/forgot-password">Request a new code</AuthLink>
        </p>
      }
    >
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <AuthError message={error} />
        <div>
          <label htmlFor="reset-code" className="mb-1 block text-xs text-mist">
            Reset code
          </label>
          <input
            id="reset-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="field"
          />
        </div>
        <div>
          <label htmlFor="reset-password" className="mb-1 block text-xs text-mist">
            New password
          </label>
          <input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
          />
        </div>
        <div>
          <label htmlFor="reset-confirm" className="mb-1 block text-xs text-mist">
            Confirm new password
          </label>
          <input
            id="reset-confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="field"
          />
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </AuthCard>
  );
}
