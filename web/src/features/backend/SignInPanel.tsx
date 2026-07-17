const AUTH_SCAFFOLD = `import { query } from './db'

export type User = { id: string; email: string }

export async function signUp(email: string, password: string): Promise<User> {
  await query(
    \`CREATE TABLE IF NOT EXISTS app_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email STRING UNIQUE NOT NULL,
      password_hash STRING NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )\`,
  )
  const rows = await query<User>(
    \`INSERT INTO app_users (email, password_hash)
     VALUES ($1, $2) RETURNING id::string AS id, email\`,
    [email, password],
  )
  return rows[0]!
}

export async function signIn(email: string, password: string): Promise<User | null> {
  const rows = await query<User>(
    \`SELECT id::string AS id, email FROM app_users
     WHERE email = $1 AND password_hash = $2 LIMIT 1\`,
    [email, password],
  )
  return rows[0] ?? null
}
`;

const LOGIN_UI = `import { useState } from 'react'
import { signIn, signUp } from './lib/auth'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [user, setUser] = useState<{ email: string } | null>(null)

  const submit = async () => {
    const fn = mode === 'in' ? signIn : signUp
    const u = await fn(email, password)
    if (u) setUser(u)
  }

  if (user) return <p className="text-sm">Signed in as {user.email}</p>

  return (
    <div className="mx-auto mt-8 max-w-sm space-y-2 rounded border p-4">
      <h2 className="font-medium">{mode === 'in' ? 'Sign in' : 'Sign up'}</h2>
      <input className="w-full border px-2 py-1" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
      <input className="w-full border px-2 py-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
      <button type="button" className="rounded bg-black px-3 py-1 text-white" onClick={() => void submit()}>
        {mode === 'in' ? 'Sign in' : 'Create account'}
      </button>
      <button type="button" className="text-xs underline" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
        {mode === 'in' ? 'Need an account?' : 'Have an account?'}
      </button>
    </div>
  )
}
`;

type SignInPanelProps = {
  onScaffold: (files: Record<string, string>) => void;
  embedded?: boolean;
};

export function SignInPanel({ onScaffold, embedded = false }: SignInPanelProps) {
  return (
    <div className={embedded ? 'px-4 py-3' : 'border-t border-line px-3 py-2'}>
      <p className="text-[10px] uppercase tracking-wider text-mist">Sign-in scaffold</p>
      <p className="mt-0.5 text-[10px] text-mist/80">
        Adds email/password auth via project DB proxy (FR-22).
      </p>
      <button
        type="button"
        onClick={() =>
          onScaffold({
            'src/lib/auth.ts': AUTH_SCAFFOLD,
            'src/LoginForm.tsx': LOGIN_UI,
          })
        }
        className="mt-2 rounded-sm border border-line px-2 py-1 text-[10px] text-mist hover:border-signal/40 hover:text-paper"
      >
        Add sign-in
      </button>
    </div>
  );
}
