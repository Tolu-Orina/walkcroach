import { createContext } from 'react';
import type { AuthState } from './types';
import type { StoredAuth } from './storage';

export type AuthContextValue = AuthState & {
  signIn: (displayName?: string) => void;
  signInAnonymous: () => void;
  signOut: () => void;
  completeSession: (stored: StoredAuth) => void;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  registerAccount: (input: {
    email: string;
    password: string;
    name?: string;
  }) => Promise<void>;
  confirmEmail: (email: string, code: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  confirmPasswordReset: (
    email: string,
    code: string,
    password: string,
  ) => Promise<void>;
  cognitoEnabled: boolean;
  devAuthAllowed: boolean;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
