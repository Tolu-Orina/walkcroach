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
    <AppShell>
      <div className="prose-marketing flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-sm border border-line bg-panel/80 p-6 shadow-lg sm:p-8">
          <div className="mb-6 flex flex-col items-center text-center">
            <BrandLogo to="/" showWordmark={false} className="mb-3" />
            <h1 className="font-display text-2xl font-bold text-paper">{title}</h1>
            {subtitle && <p className="mt-2 text-sm text-mist">{subtitle}</p>}
          </div>
          {children}
          {footer && <div className="mt-6 border-t border-line pt-4 text-center">{footer}</div>}
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
    <Link to={to} className="interactive text-sm text-signal hover:underline">
      {children}
    </Link>
  );
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-sm border border-ember/40 bg-ember/10 px-3 py-2 text-sm text-ember" role="alert">
      {message}
    </p>
  );
}

export function AuthSuccess({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-sm border border-signal/30 bg-signal/10 px-3 py-2 text-sm text-paper" role="status">
      {message}
    </p>
  );
}
