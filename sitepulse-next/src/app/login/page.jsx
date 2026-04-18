'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/supabaseClient';
import { LogIn, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const router = useRouter();

  // Redirect if already logged in
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.push('/');
      }
    });
  }, [router]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push('/');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.3),rgba(255,255,255,0))] px-4 py-8 relative overflow-hidden">
      {/* Decorative background blobs */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl opacity-50 mix-blend-screen pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[30rem] h-[30rem] bg-indigo-500/20 rounded-full blur-3xl opacity-50 mix-blend-screen pointer-events-none" />

      <div className="w-full max-w-md relative z-10 transition-all duration-500 animate-in fade-in slide-in-from-bottom-8">
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-8">
            <div className="flex items-center justify-center w-16 h-16 bg-blue-500/10 text-blue-400 rounded-2xl mb-8 mx-auto shadow-[0_0_20px_rgba(59,130,246,0.1)]">
              <LogIn size={32} strokeWidth={1.5} />
            </div>

            <h2 className="text-3xl font-light text-center text-slate-100 mb-2">Welcome Back</h2>
            <p className="text-center text-slate-400 mb-8">Sign in to access SitePulse</p>

            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300" htmlFor="email">
                  Email Address
                </label>
                <div className="relative">
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all placeholder:text-slate-500"
                    placeholder="name@company.com"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300" htmlFor="password">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all placeholder:text-slate-500"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm text-center">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-all shadow-[0_0_15px_rgba(37,99,235,0.4)] disabled:opacity-50 disabled:cursor-not-allowed group mt-4"
              >
                {loading ? (
                  <Loader2 className="animate-spin w-5 h-5" />
                ) : (
                  <span>Sign In</span>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
