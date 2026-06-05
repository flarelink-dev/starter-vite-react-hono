// `useSession()` — current user state for the React tree.
//
// Single in-memory cache + subscription pattern: every component using
// the hook reads from the same cache and gets re-rendered when auth
// transitions happen (sign-in / sign-out). Avoids each consumer firing
// its own /api/auth/get-session request.

import { useEffect, useState } from 'react';
import { flarelink } from './flarelink.ts';

export type AppUser = {
  id: string;
  email: string;
  name: string | null;
};

type SessionState =
  | { status: 'loading' }
  | { status: 'signed-in'; user: AppUser }
  | { status: 'signed-out' };

let cache: SessionState = { status: 'loading' };
const subscribers = new Set<(s: SessionState) => void>();

function set(next: SessionState) {
  cache = next;
  for (const s of subscribers) s(next);
}

let loading: Promise<void> | null = null;
async function loadOnce() {
  if (loading) return loading;
  loading = (async () => {
    try {
      // getMe() returns the User (id / email / name / …) or null when
      // signed out. The cousin getSession() returns just the Session row
      // (id / userId / expiresAt / …) — no email / name on it, so getMe
      // is the right call for "give me the user object".
      const user = await flarelink.auth.getMe();
      if (user) {
        set({
          status: 'signed-in',
          user: { id: user.id, email: user.email, name: user.name ?? null },
        });
      } else {
        set({ status: 'signed-out' });
      }
    } catch {
      set({ status: 'signed-out' });
    }
  })();
  await loading;
}

/** Force a refresh — call after sign-in / sign-up / sign-out so the cache
 *  reflects the new state immediately rather than waiting on next mount.
 *
 *  Returns a promise that resolves once the new getMe() lands. Await this
 *  before navigating: otherwise navigate() fires while cache is still the
 *  pre-signin state, RequireAuth bounces back to /login, and (in StrictMode)
 *  the subscriber may already be torn down by the time setState lands. */
export function refreshSession(): Promise<void> {
  loading = null;
  return loadOnce();
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>(cache);
  useEffect(() => {
    subscribers.add(setState);
    void loadOnce();
    return () => {
      subscribers.delete(setState);
    };
  }, []);
  return state;
}
