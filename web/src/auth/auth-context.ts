import { createContext } from 'react';
import type { AuthState } from './types';

export type AuthContextValue = AuthState & {
  signIn: (displayName?: string) => void;
  signInAnonymous: () => void;
  signOut: () => void;
  cognitoEnabled: boolean;
  devAuthAllowed: boolean;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
