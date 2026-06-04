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
      const session = await flarelink.auth.getSession();
      if (session?.user) {
        set({
          status: 'signed-in',
          user: {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name ?? null,
          },
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
 *  reflects the new state immediately rather than waiting on next mount. */
export function refreshSession() {
  loading = null;
  void loadOnce();
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
