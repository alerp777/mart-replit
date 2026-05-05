/**
 * Firebase Client SDK — Rider App
 *
 * Gracefully disabled when VITE_FIREBASE_API_KEY is not set.
 * When Firebase is enabled, used for phone auth and Google Sign-In
 * in FIREBASE / HYBRID auth modes.
 */

import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _initialized = false;

function getFirebaseConfig() {
  const apiKey = import.meta.env["VITE_FIREBASE_API_KEY"];
  if (!apiKey) return null;
  return {
    apiKey,
    authDomain:        import.meta.env["VITE_FIREBASE_AUTH_DOMAIN"]  ?? "",
    projectId:         import.meta.env["VITE_FIREBASE_PROJECT_ID"]   ?? "",
    storageBucket:     import.meta.env["VITE_FIREBASE_STORAGE_BUCKET"] ?? "",
    messagingSenderId: import.meta.env["VITE_FIREBASE_MESSAGING_SENDER_ID"] ?? "",
    appId:             import.meta.env["VITE_FIREBASE_APP_ID"]       ?? "",
  };
}

export async function getFirebaseAuth(): Promise<Auth | null> {
  if (_initialized) return _auth;
  _initialized = true;

  const config = getFirebaseConfig();
  if (!config) return null;

  try {
    const { initializeApp, getApps } = await import("firebase/app");
    const { getAuth } = await import("firebase/auth");
    _app = getApps().length === 0 ? initializeApp(config) : getApps()[0]!;
    _auth = getAuth(_app);
    return _auth;
  } catch {
    return null;
  }
}

export function isFirebaseConfigured(): boolean {
  return !!import.meta.env["VITE_FIREBASE_API_KEY"];
}
