// Firebase Auth (Google). In-memory persistence only: no tokens in localStorage/IndexedDB (AGENTS.md guardrails).
import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  browserPopupRedirectResolver,
  inMemoryPersistence,
  initializeAuth,
  onIdTokenChanged,
  signInWithPopup,
  signOut as fbSignOut,
  type Auth,
  type User,
} from "firebase/auth";
import { setIdToken } from "./api/client";

const env = import.meta.env;
let auth: Auth | null = null;

function getAuth(): Auth | null {
  if (auth) return auth;
  if (!env.VITE_FIREBASE_API_KEY) return null;
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
  });
  auth = initializeAuth(app, { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  return auth;
}

export const authConfigured = () => Boolean(env.VITE_FIREBASE_API_KEY);

export function watchUser(cb: (u: User | null) => void): () => void {
  const a = getAuth();
  if (!a) {
    cb(null);
    return () => undefined;
  }
  return onIdTokenChanged(a, async (u) => {
    setIdToken(u ? await u.getIdToken() : null);
    cb(u);
  });
}

export async function signIn(): Promise<void> {
  const a = getAuth();
  if (!a) throw new Error("Sign-in isn't configured: set VITE_FIREBASE_* env vars.");
  await signInWithPopup(a, new GoogleAuthProvider());
}

export async function signOut(): Promise<void> {
  const a = getAuth();
  if (a) await fbSignOut(a);
}
