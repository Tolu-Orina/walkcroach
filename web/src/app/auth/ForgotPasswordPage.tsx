import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { cognitoErrorMessage } from '../../auth/cognito-idp';
import { useAuth } from '../../auth/useAuth';
import { AuthCard, AuthError, AuthLink } from '../../components/auth/AuthCard';

export function ForgotPasswordPage() {
  const { cognitoEnabled, requestPasswordReset } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!cognitoEnabled) {
    return <Navigate to="/signin" replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(email);
      navigate(`/reset-password?email=${encodeURIComponent(email.trim())}`);
    } catch (err) {
      setError(cognitoErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Forgot password"
      subtitle="We'll email you a reset code."
      footer={
        <p className="text-sm text-mist">
          Remembered it? <AuthLink to="/signin">Back to sign in</AuthLink>
        </p>
      }
    >
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <AuthError message={error} />
        <div>
          <label htmlFor="forgot-email" className="mb-1 block text-xs text-mist">
            Email
          </label>
          <input
            id="forgot-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
          />
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Sending…' : 'Send reset code'}
        </button>
      </form>
    </AuthCard>
  );
}
