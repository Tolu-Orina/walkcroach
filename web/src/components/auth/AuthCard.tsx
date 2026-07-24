import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../AppShell';
import { BrandLogo } from '../BrandLogo';

type AuthCardProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <AppShell marketing>
      <div className="prose-marketing flex min-h-[calc(100vh-4.25rem)] items-center justify-center px-4 py-12">
        <div className="glass-strong glass-hairline wc-enter w-full max-w-md p-7 sm:p-9">
          <div className="mb-7 flex flex-col items-center text-center">
            <BrandLogo to="/" showWordmark={false} className="mb-4" />
            <h1 className="font-display text-[1.75rem] font-extrabold tracking-tight text-paper">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-mist">
                {subtitle}
              </p>
            )}
          </div>
          {children}
          {footer && (
            <div className="mt-7 border-t border-line/70 pt-5 text-center">
              {footer}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

export function AuthLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="interactive text-sm font-medium text-signal hover:underline"
    >
      {children}
    </Link>
  );
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      className="rounded-[var(--radius-control)] border border-ember/35 bg-ember/10 px-3 py-2.5 text-sm text-ember"
      role="alert"
    >
      {message}
    </p>
  );
}

export function AuthSuccess({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      className="rounded-[var(--radius-control)] border border-signal/30 bg-signal/10 px-3 py-2.5 text-sm text-paper"
      role="status"
    >
      {message}
    </p>
  );
}
