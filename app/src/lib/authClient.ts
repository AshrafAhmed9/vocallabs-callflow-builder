import { NHOST_AUTH_URL } from "./env";

export interface NhostUser {
  id: string;
  email: string;
  displayName?: string;
}

export interface NhostSession {
  accessToken: string;
  accessTokenExpiresIn: number; // seconds
  refreshToken: string;
  user: NhostUser;
}

const STORAGE_KEY = "vocallabs.nhost.session";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${NHOST_AUTH_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (json && (json.message || json.error)) || `Request to ${path} failed (${res.status})`;
    throw new Error(message);
  }
  return json as T;
}

export function signInEmailPassword(email: string, password: string) {
  return post<NhostSession>("/signin/email-password", { email, password });
}

export function signUpEmailPassword(email: string, password: string) {
  return post<NhostSession | { session: null }>("/signup/email-password", { email, password });
}

export function refreshToken(refreshTokenValue: string) {
  return post<NhostSession>("/token", { refreshToken: refreshTokenValue });
}

export function signOutRequest(refreshTokenValue: string) {
  return post("/signout", { refreshToken: refreshTokenValue }).catch(() => {
    // best-effort; still clear local session regardless
  });
}

export function loadSession(): NhostSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as NhostSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: NhostSession | null) {
  if (typeof window === "undefined") return;
  if (session) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
