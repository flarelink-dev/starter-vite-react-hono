import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { flarelink } from '../lib/flarelink.ts';
import { refreshSession, useSession } from '../lib/session.ts';

export function Login() {
  const session = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  if (session.status === 'signed-in') return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await flarelink.auth.signIn({ email, password });
      // Await the refresh so cache is signed-in BEFORE we navigate —
      // otherwise RequireAuth on / sees the pre-signin cache and bounces
      // back to /login.
      await refreshSession();
      navigate('/');
    } catch (err) {
      // BetterAuth's EMAIL_NOT_VERIFIED auto-resends the verification
      // link via `sendOnSignIn: true` — surface a clear message rather
      // than a generic error.
      const code = (err as { code?: string }).code;
      if (code === 'EMAIL_NOT_VERIFIED') {
        setError('Check your inbox — we just sent a fresh verification link.');
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white border border-stone-200 rounded-xl p-8 shadow-sm"
      >
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Sign in</h1>
        <p className="text-sm text-stone-500 mb-6">Welcome back.</p>

        <label className="block mb-4">
          <span className="block text-xs font-medium text-stone-600 mb-1.5">Email</span>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
          />
        </label>
        <label className="block mb-5">
          <span className="block text-xs font-medium text-stone-600 mb-1.5">Password</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
          />
        </label>

        {error && <div className="text-sm text-red-600 mb-4">{error}</div>}

        <button
          type="submit"
          disabled={busy}
          className="w-full py-2 bg-stone-900 text-white font-medium rounded-md hover:bg-stone-800 disabled:opacity-50 transition-colors"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-sm text-stone-500 text-center mt-5">
          No account?{' '}
          <Link to="/signup" className="text-orange-600 hover:underline">
            Sign up
          </Link>
        </p>
      </form>
    </div>
  );
}
