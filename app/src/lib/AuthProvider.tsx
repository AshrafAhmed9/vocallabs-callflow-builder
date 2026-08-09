"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  loadSession,
  refreshToken as refreshTokenRequest,
  saveSession,
  signInEmailPassword,
  signOutRequest,
  signUpEmailPassword,
  type NhostSession,
  type NhostUser,
} from "./authClient";

interface AuthContextValue {
  user: NhostUser | null;
  accessToken: string | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ needsVerification: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Refresh a bit before actual expiry.
const REFRESH_SKEW_SECONDS = 60;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<NhostSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback((s: NhostSession | null) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    if (!s) return;
    const delayMs =
      Math.max(s.accessTokenExpiresIn - REFRESH_SKEW_SECONDS, 5) * 1000;
    refreshTimer.current = setTimeout(async () => {
      try {
        const next = await refreshTokenRequest(s.refreshToken);
        setSession(next);
        saveSession(next);
        scheduleRefresh(next);
      } catch {
        setSession(null);
        saveSession(null);
      }
    }, delayMs);
  }, []);

  useEffect(() => {
    const existing = loadSession();
    if (existing) {
      // Try to refresh immediately to validate the stored session.
      refreshTokenRequest(existing.refreshToken)
        .then((next) => {
          setSession(next);
          saveSession(next);
          scheduleRefresh(next);
        })
        .catch(() => {
          saveSession(null);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const s = await signInEmailPassword(email, password);
      setSession(s);
      saveSession(s);
      scheduleRefresh(s);
    },
    [scheduleRefresh]
  );

  const signUp = useCallback(async (email: string, password: string) => {
    const result = await signUpEmailPassword(email, password);
    if ("accessToken" in result) {
      setSession(result);
      saveSession(result);
      scheduleRefresh(result);
      return { needsVerification: false };
    }
    return { needsVerification: true };
  }, [scheduleRefresh]);

  const signOut = useCallback(async () => {
    if (session) await signOutRequest(session.refreshToken);
    setSession(null);
    saveSession(null);
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, [session]);

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        accessToken: session?.accessToken ?? null,
        isLoading,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
