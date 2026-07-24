export type AuthUser = {
  id: string;
  displayName: string;
  isAnonymous: boolean;
  email?: string | null;
};

export type AuthState = {
  user: AuthUser | null;
  token: string | null;
  status: 'loading' | 'anonymous' | 'authenticated';
};
