import { Navigate } from 'react-router';
import { useSession } from '../lib/session.ts';

/** Gates a route on an authenticated session. Loading → spinner-ish
 *  placeholder; signed-out → redirect to /login. Children render only
 *  for signed-in users. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const session = useSession();
  if (session.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center text-stone-400 text-sm">
        loading…
      </div>
    );
  }
  if (session.status === 'signed-out') return <Navigate to="/login" replace />;
  return <>{children}</>;
}
