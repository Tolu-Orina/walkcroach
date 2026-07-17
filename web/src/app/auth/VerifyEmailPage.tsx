import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { cognitoErrorMessage } from '../../auth/cognito-idp';
import { useAuth } from '../../auth/useAuth';
import {
  AuthCard,
  AuthError,
  AuthLink,
  AuthSuccess,
} from '../../components/auth/AuthCard';

export function VerifyEmailPage() {
  const { cognitoEnabled, confirmEmail, resendConfirmation } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const email = params.get('email') ?? '';
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(
    email ? `We sent a verification code to ${email}.` : null,
  );
  const [busy, setBusy] = useState(false);

  if (!cognitoEnabled) {
    return <Navigate to="/signin" replace />;
  }

  if (!email) {
    return <Navigate to="/signup" replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await confirmEmail(email, code);
      navigate('/signin?verified=1', { replace: true });
    } catch (err) {
      setError(cognitoErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      await resendConfirmation(email);
      setSuccess('A new code was sent to your email.');
    } catch (err) {
      setError(cognitoErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Verify your email"
      subtitle="Enter the 6-digit code from your inbox."
      footer={
        <p className="text-sm text-mist">
          Wrong email? <AuthLink to="/signup">Start over</AuthLink>
        </p>
      }
    >
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <AuthSuccess message={success} />
        <AuthError message={error} />
        <div>
          <label htmlFor="verify-code" className="mb-1 block text-xs text-mist">
            Verification code
          </label>
          <input
            id="verify-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="field text-center tracking-widest"
            placeholder="123456"
          />
        </div>
        <button type="submit" disabled={busy || !code.trim()} className="btn-primary w-full">
          {busy ? 'Verifying…' : 'Verify email'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onResend()}
          className="btn-ghost w-full text-sm"
        >
          Resend code
        </button>
      </form>
    </AuthCard>
  );
}
