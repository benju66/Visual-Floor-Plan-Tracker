'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '@/supabaseClient';
import { Loader2 } from 'lucide-react';

const AuthContext = createContext({});

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let mounted = true;

    async function getInitialSession() {
      const { data: { session } } = await supabase.auth.getSession();
      if (mounted) {
        setSession(session);
        setLoading(false);
      }
    }

    getInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (mounted) {
          setSession(session);
          setLoading(false);
        }
      }
    );

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      if (!session && pathname !== '/login') {
        // Save the full URL (including query parameters like ?link_procore_project=...)
        const currentUrl = encodeURIComponent(pathname + (window.location.search || ''));
        router.push(`/login?returnTo=${currentUrl}`);
      }
    }
  }, [session, loading, pathname, router]);

  // NEW: Clean up the giant Supabase token hash from the URL after login
  useEffect(() => {
    if (session && typeof window !== 'undefined' && window.location.hash.includes('access_token=')) {
      router.replace(pathname + (window.location.search || ''));
    }
  }, [session, pathname, router]);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <Loader2 className="animate-spin w-8 h-8 text-blue-500" />
      </div>
    );
  }

  // Prevent flash of unauthenticated content before redirect kicks in
  if (!session && pathname !== '/login') {
    return null; 
  }

  return (
    <AuthContext.Provider value={{ session }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
