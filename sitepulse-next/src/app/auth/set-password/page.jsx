'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/supabaseClient';
import { useAuth } from '@/providers/AuthProvider';
import { KeyRound, Loader2 } from 'lucide-react';

// Landing page for the Supabase invite email link. Clicking the email
// establishes a session (token in the URL hash, picked up by supabase-js), so
// by the time this renders the user is signed in but has no password yet. They
// set one here; their project membership was already linked by the
// handle_new_user trigger when the invite created their account.
export default function SetPasswordPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push('/dashboard');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.3),rgba(255,255,255,0))] px-4 py-8 relative overflow-hidden">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl opacity-50 mix-blend-screen pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[30rem] h-[30rem] bg-indigo-500/20 rounded-full blur-3xl opacity-50 mix-blend-screen pointer-events-none" />

      <div className="w-full max-w-md relative z-10 transition-all duration-500 animate-in fade-in slide-in-from-bottom-8">
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-8">
            <div className="flex items-center justify-center w-16 h-16 bg-blue-500/10 text-blue-400 rounded-2xl mb-8 mx-auto shadow-[0_0_20px_rgba(59,130,246,0.1)]">
              <KeyRound size={32} strokeWidth={1.5} />
            </div>

            <h2 className="text-3xl font-light text-center text-slate-100 mb-2">Set Your Password</h2>
            <p className="text-center text-slate-400 mb-8">
              {session?.user?.email
                ? `Finish setting up ${session.user.email}`
                : 'Choose a password to finish setting up your account'}
            </p>

            {!session ? (
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl text-sm text-center">
                This invite link is invalid or has expired. Please ask an admin to resend your invitation, or{' '}
                <a href="/login" className="underline">sign in</a> if you already have an account.
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300" htmlFor="password">
                    New Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all placeholder:text-slate-500"
                    placeholder="At least 8 characters"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300" htmlFor="confirm">
                    Confirm Password
                  </label>
                  <input
                    id="confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all placeholder:text-slate-500"
                    placeholder="Re-enter your password"
                    required
                  />
                </div>

                {error && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm text-center">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-all shadow-[0_0_15px_rgba(37,99,235,0.4)] disabled:opacity-50 disabled:cursor-not-allowed mt-4"
                >
                  {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <span>Set Password &amp; Continue</span>}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
