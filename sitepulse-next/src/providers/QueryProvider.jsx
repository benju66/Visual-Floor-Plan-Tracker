"use client";

import { QueryClient, MutationCache, defaultShouldDehydrateMutation } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, useEffect } from 'react';
import { persister } from '@/utils/persister';
import { supabase } from '@/supabaseClient';

export default function QueryProvider({ children }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache(),
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60 * 5, // 5 minutes
            gcTime: 1000 * 60 * 60 * 24, // 24 hours
            networkMode: 'offlineFirst', // Allows reading cache while offline
          },
          mutations: {
            networkMode: 'offlineFirst', // Queues mutations when offline
            retry: 3,
          }
        },
      })
  );

  useEffect(() => {
    // Listen to global status updates and surgically inject them into the caches
    const channel = supabase.channel('sitepulse-global-sync')
      .on(
        'postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'status_logs' }, 
        (payload) => {
          const newLog = payload.new;

          // 1. Inject into the specific sheet's cache
          // (Note: This relies on the active sheets being cached. We update all instances.)
          const queries = queryClient.getQueriesData({ queryKey: ['statuses'] });
          queries.forEach(([queryKey, oldData]) => {
            if (!oldData) return;
            queryClient.setQueryData(queryKey, (old) => {
              if (!old) return old;
              const filtered = old.filter(s => !(s.unit_id === newLog.unit_id && s.track === newLog.track && s.milestone === newLog.milestone));
              return [...filtered, newLog];
            });
          });

          // 2. Inject into the global dashboard cache
          queryClient.setQueriesData({ queryKey: ['all_project_statuses'] }, (old) => {
            if (!old) return old;
            const filtered = old.filter(s => !(s.unit_id === newLog.unit_id && s.track === newLog.track && s.milestone === newLog.milestone));
            return [...filtered, newLog];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ 
        persister,
        dehydrateOptions: {
          shouldDehydrateMutation: (mutation) => {
            return defaultShouldDehydrateMutation(mutation) || mutation.state.isPaused;
          },
        },
      }}
    >
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </PersistQueryClientProvider>
  );
}
