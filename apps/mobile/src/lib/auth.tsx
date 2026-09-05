import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import * as apiClient from './api';

interface AuthState {
  ready: boolean;
  signedIn: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    apiClient.loadToken().then((t) => {
      setSignedIn(!!t);
      setReady(true);
    });
  }, []);

  const value: AuthState = {
    ready,
    signedIn,
    signIn: async (email, password) => {
      await apiClient.signIn(email, password);
      setSignedIn(true);
    },
    signUp: async (name, email, password) => {
      await apiClient.signUp(name, email, password);
      setSignedIn(true);
    },
    signOut: async () => {
      await apiClient.signOut();
      setSignedIn(false);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
