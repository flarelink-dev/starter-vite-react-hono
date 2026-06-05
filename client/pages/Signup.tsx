import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import { flarelink } from '../lib/flarelink.ts';
import { useSession } from '../lib/session.ts';

export function Signup() {
  const session = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (session.status === 'signed-in') return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // If your Flarelink auth Worker has email verification on (default),
      // the user lands here in "check your email" state. If verification
      // is off, autoSignInAfterVerification kicks in and they're signed
      // in immediately — useSession() will pick it up.
      await flarelink.auth.signUp({
        email,
        password,
        name: name.trim() || (email.split('@')[0] ?? 'there'),
      });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white border border-stone-200 rounded-xl p-8 shadow-sm text-center">
          <h1 className="text-2xl font-semibold tracking-tight mb-2">Check your email</h1>
          <p className="text-sm text-stone-500 mb-1">We sent a verification link to</p>
          <p className="font-mono text-sm text-stone-900 mb-6">{email}</p>
          <p className="text-xs text-stone-500">
            Click it and you'll land back here signed in. Wrong address?{' '}
            <button
              type="button"
              onClick={() => setSent(false)}
              className="text-orange-600 hover:underline"
            >
              try again
            </button>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white border border-stone-200 rounded-xl p-8 shadow-sm"
      >
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Create account</h1>
        <p className="text-sm text-stone-500 mb-6">Sign up to keep notes.</p>

        <label className="block mb-4">
          <span className="block text-xs font-medium text-stone-600 mb-1.5">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane"
            className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
          />
        </label>
        <label className="block mb-4">
          <span className="block text-xs font-medium text-stone-600 mb-1.5">Email</span>
          <input
            type="email"
            required
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
            placeholder="At least 8 characters"
            className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
          />
        </label>

        {error && <div className="text-sm text-red-600 mb-4">{error}</div>}

        <button
          type="submit"
          disabled={busy}
          className="w-full py-2 bg-orange-600 text-white font-medium rounded-md hover:bg-orange-500 disabled:opacity-50 transition-colors"
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>

        <p className="text-sm text-stone-500 text-center mt-5">
          Already have one?{' '}
          <Link to="/login" className="text-orange-600 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
